#!/usr/bin/env python3
"""Probe the pinned upstream LSP on isolated copies; no Zed settings changed."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import select
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
VERSION = "0.0.7"
INTEGRITY = "2HRiiz18gZ9q/Eq7KCqWE/PCeXst3QWnhfHcba0t5L70oocTkvI1w1Qd7UefkDAuMrWrHi7ceMMMz9Igxh5dMA=="
CASES = [
    ("my-app", "app/actions/home-page.tsx", "few_early_kangaroo_endure", "Get started"),
    ("spa-remix3", "app/ui/app-shell.tsx", "brand_name", None),
]


def fingerprints(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file()}


def position(text, offset):
    prefix = text[:offset]
    return {"line": prefix.count("\n"),
            "character": len(prefix.rsplit("\n", 1)[-1].encode("utf-16-le")) // 2}


class Client:
    def __init__(self, server, root):
        self.process = subprocess.Popen([shutil.which("node"), str(server)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL)
        self.buffer = b""
        self.sequence = 0
        self.capabilities = self.request("initialize", {
            "rootUri": root.as_uri(), "capabilities": {}, "initializationOptions": {}})
        self.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})

    def send(self, message):
        data = json.dumps(message).encode()
        self.process.stdin.write(f"Content-Length: {len(data)}\r\n\r\n".encode() + data)
        self.process.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        request_id = self.sequence
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if b"\r\n\r\n" in self.buffer:
                head, body = self.buffer.split(b"\r\n\r\n", 1)
                length = int(re.search(rb"Content-Length:\s*(\d+)", head, re.I).group(1))
                if len(body) >= length:
                    message = json.loads(body[:length])
                    self.buffer = body[length:]
                    if message.get("id") == request_id:
                        if "error" in message:
                            raise RuntimeError(message["error"])
                        return message.get("result")
                    continue
            ready, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if ready:
                data = os.read(self.process.stdout.fileno(), 65536)
                if not data:
                    raise RuntimeError("LSP exited before response")
                self.buffer += data
        raise TimeoutError(method)

    def close(self):
        try:
            self.request("shutdown", None)
            self.send({"jsonrpc": "2.0", "method": "exit"})
            self.process.wait(timeout=5)
        finally:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()


def extract(client, file, text, selected):
    offset = text.index(selected)
    actions = client.request("textDocument/codeAction", {
        "textDocument": {"uri": file.as_uri()},
        "range": {"start": position(text, offset), "end": position(text, offset + len(selected))},
        "context": {"diagnostics": [], "only": ["refactor.extract"]}})
    action = next((a for a in actions if a.get("kind") == "refactor.extract"), None)
    if not action:
        return {"action": None}
    changes = action["edit"]["changes"]
    edits = changes[file.as_uri()]
    catalog_uri = next(uri for uri in changes if uri != file.as_uri())
    catalog = json.loads(changes[catalog_uri][0]["newText"])
    return {"title": action["title"], "replacement": edits[-1]["newText"],
            "files": len(changes), "catalog_uri": catalog_uri,
            "source_edit_count": len(edits), "catalog_contains_selected": selected in catalog.values(),
            "versioned_document_changes": "documentChanges" in action["edit"]}


def main():
    scratch = Path.home() / ".hermes" / "cache" / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(
        f"https://registry.npmjs.org/inlang-language-server/-/inlang-language-server-{VERSION}.tgz", timeout=30).read()
    assert base64.b64encode(hashlib.sha512(data).digest()).decode() == INTEGRITY
    results = {"package": f"inlang-language-server@{VERSION}", "integrity": "PASS", "projects": []}
    with tempfile.TemporaryDirectory(prefix="sherlock-lsp-probe-", dir=scratch) as temp:
        work = Path(temp)
        server = work / "server.mjs"
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            server.write_bytes(archive.extractfile("package/bin/server.mjs").read())
        for name, relative, key, selected in CASES:
            original = ROOT / "examples-apps" / name
            fixture = work / name
            for relative_path in ["project.inlang/settings.json", "messages/en.json", "messages/fr.json", relative]:
                dest = fixture / relative_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original / relative_path, dest)
            file = fixture / relative
            text = file.read_text()
            import_line = next(line for line in text.splitlines() if line.startswith("import") and re.search(r"\bm\b", line))
            bare = file.parent / "probe-no-existing-call.tsx"
            bare_text = import_line + '\nexport const Example = () => <p>Fresh greeting</p>\n'
            bare.write_text(bare_text)
            before = fingerprints(fixture)
            client = Client(server, fixture)
            try:
                offset = text.index("m." + key) + 2
                hover = client.request("textDocument/hover", {
                    "textDocument": {"uri": file.as_uri()}, "position": position(text, offset)})
                assert hover and key in hover["contents"]["value"]
                result = {"project": name, "hover": hover["contents"]["value"],
                          "rename_advertised": client.capabilities["capabilities"].get("renameProvider", False)}
                if selected:
                    result["existing_file_extract"] = extract(client, file, text, selected)
                    assert result["existing_file_extract"]["replacement"].startswith("{m.")
                result["no_existing_call_extract"] = extract(client, bare, bare_text, "Fresh greeting")
                result["no_existing_call_uses_m"] = result["no_existing_call_extract"].get("replacement", "").startswith("{m.")
                result["fixture_unchanged"] = before == fingerprints(fixture)
                assert result["fixture_unchanged"]
                results["projects"].append(result)
            finally:
                client.close()
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
