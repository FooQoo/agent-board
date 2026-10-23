#!/usr/bin/env python3
"""Generate THIRD_PARTY_NOTICES.txt from the locked dependency graphs.

Usage:
  generate-notices.py                      write THIRD_PARTY_NOTICES.txt
  generate-notices.py --check              fail if the file is out of date
  generate-notices.py --stdout             print instead of writing
  generate-notices.py --components FILE    render a component list (JSON) as is

Sources: `cargo metadata --locked` for each release target (normal
dependencies only), `pnpm licenses` for the web production dependencies, and
the Rust toolchain's library COPYRIGHT file. Choices that cannot be derived
(OR selections, source pointers) live in notices-config.json. The output has
no timestamps or local paths, so equal inputs give equal bytes.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("notices-config.json")
OUT = ROOT / "THIRD_PARTY_NOTICES.txt"
LABELS = {"aarch64-apple-darwin": "macOS arm64", "x86_64-apple-darwin": "macOS x86_64"}
FILE_NAME = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)", re.I)
KEYWORDS = {"MIT": "MIT", "Apache-2.0": "APACHE", "ISC": "ISC", "Zlib": "ZLIB", "Unlicense": "UNLICENSE"}
COPYLEFT = re.compile(r"MPL-|EPL-")
HEADER = """Agent Board - Third-Party Notices

Agent Board's original code is licensed under the MIT License (see LICENSE).
Third-party components retain their own copyrights and licenses.
This file covers components distributed with the macOS binaries, embedded
web UI and monitor, and the documentation site. Distribution labels below
identify where each component is included.
"""
RULE = "=" * 60


def fail(message):
    print(f"generate-notices: {message}", file=sys.stderr)
    sys.exit(1)


def run(cmd, cwd=ROOT):
    done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if done.returncode:
        fail(f"{' '.join(cmd)} failed: {done.stderr.strip()[:300]}")
    return done.stdout


# --- license expressions -------------------------------------------------

def reduce_license(expr, prefer):
    """Resolve every OR to its preferred alternative; keep AND and WITH."""
    tokens = re.findall(r"\(|\)|[^\s()]+", expr.replace("/", " OR "))
    pos = 0

    def rank(text):
        first = re.split(r"[ )(]", text.strip("() "))[0]
        return prefer.index(first) if first in prefer else len(prefer)

    def parse_or():
        nonlocal pos
        options = [parse_and()]
        while pos < len(tokens) and tokens[pos] == "OR":
            pos += 1
            options.append(parse_and())
        return min(options, key=lambda o: max(rank(p) for p in o.split(" AND ")))

    def parse_and():
        nonlocal pos
        parts = [parse_atom()]
        while pos < len(tokens) and tokens[pos] == "AND":
            pos += 1
            parts.append(parse_atom())
        return " AND ".join(parts)

    def parse_atom():
        nonlocal pos
        if tokens[pos] == "(":
            pos += 1
            inner = parse_or()
            pos += 1
            return inner
        atom = tokens[pos]
        pos += 1
        if pos < len(tokens) and tokens[pos] == "WITH":
            atom += f" WITH {tokens[pos + 1]}"
            pos += 2
        return atom

    return parse_or()


def license_texts(directory, original, resolved):
    files = sorted(p for p in Path(directory).iterdir() if p.is_file() and FILE_NAME.match(p.name))
    if original != resolved and len(files) > 1:
        words = [KEYWORDS.get(i, i.upper()) for i in re.split(r" AND |\s", resolved) if i in KEYWORDS or "-" in i]
        narrowed = [f for f in files if any(w in f.name.upper() for w in words)]
        files = narrowed or files
    return files


# --- collection ----------------------------------------------------------

def rust_components(config):
    lock = {}
    for block in (ROOT / "Cargo.lock").read_text(encoding="utf-8").split("[[package]]")[1:]:
        fields = dict(re.findall(r'^(\w+) = "(.*)"$', block, re.M))
        lock[(fields["name"], fields["version"])] = fields
    found = {}
    for target, label in LABELS.items():
        meta = json.loads(run(["cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", target]))
        packages = {p["id"]: p for p in meta["packages"]}
        nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
        seen, todo = set(), [meta["resolve"]["root"]]
        while todo:
            node = nodes[todo.pop()]
            for dep in node["deps"]:
                if any(k["kind"] is None for k in dep["dep_kinds"]) and dep["pkg"] not in seen:
                    seen.add(dep["pkg"])
                    todo.append(dep["pkg"])
        for pid in seen:
            pkg = packages[pid]
            entry = found.setdefault((pkg["name"], pkg["version"]), {"pkg": pkg, "dist": []})
            entry["dist"].append(label)
    items = []
    for (name, version), entry in found.items():
        pkg = entry["pkg"]
        expr = pkg["license"] or fail(f"{name} {version} declares no license expression")
        items.append(make_component(config, name, version, entry["dist"], expr, Path(pkg["manifest_path"]).parent,
                                    pkg.get("repository") or f"https://crates.io/crates/{name}",
                                    crate_source(lock.get((name, version), {}), name, version)))
    return items


def crate_source(fields, name, version):
    if "checksum" not in fields:
        return None
    url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
    return {"url": url, "checksum": fields["checksum"], "patches": "None", "modifications": "None",
            "build": f"https://crates.io/crates/{name}/{version}"}


def npm_source(integrity, name, version):
    if (name, version) not in integrity:
        return None
    base = name.split("/")[-1]
    return {"url": f"https://registry.npmjs.org/{name}/-/{base}-{version}.tgz", "checksum": integrity[(name, version)],
            "patches": "None", "modifications": "None", "build": f"https://www.npmjs.com/package/{name}/v/{version}"}


def web_components(config):
    items = []
    lock = (ROOT / "web/pnpm-lock.yaml").read_text(encoding="utf-8")
    integrity = {m[0:2]: m[2] for m in re.findall(
        r"^  '?(@?[^@\s']+(?:/[^@\s']+)?)@(\d[^':\s]*)'?:\n    resolution: \{integrity: (\S+?)[,}]", lock, re.M)}
    listing = json.loads(run(["pnpm", "--dir", "web", "licenses", "list", "--json", "--prod"]))
    for group in listing.values():
        for pkg in group:
            for version, path in zip(pkg["versions"], pkg["paths"]):
                items.append(make_component(config, pkg["name"], version, ["Web", "Monitor"], pkg["license"], path,
                                            pkg.get("homepage") or f"https://www.npmjs.com/package/{pkg['name']}",
                                            npm_source(integrity, pkg["name"], version)))
    return items


def toolchain_component():
    sysroot = Path(run(["rustc", "--print", "sysroot"]).strip())
    version = run(["rustc", "-V"]).split()[1]
    text = sysroot / "share/doc/rust/COPYRIGHT-library.html"
    if not text.is_file():
        fail("the Rust toolchain has no share/doc/rust/COPYRIGHT-library.html (install the rust-docs component)")
    return {"name": "rust-standard-library", "version": version, "distribution": sorted(LABELS.values()),
            "license": "MIT OR Apache-2.0", "upstream": "https://github.com/rust-lang/rust", "texts": [text]}


def declared_notice(holder, license_id):
    """A notice for a package that ships no license file (MIT only)."""
    if license_id != "MIT":
        fail(f"declared notices support MIT only, not {license_id}")
    body = "\n".join((ROOT / "LICENSE").read_text(encoding="utf-8").split("\n")[4:]).rstrip("\n")
    return (f"MIT License\n\nCopyright (c) {holder}\n\n"
            "(This package ships no license file; the notice above is taken from the package metadata.)\n\n" + body)


def make_component(config, name, version, dist, expr, directory, upstream, source):
    resolved = config["choose"].get(name) or reduce_license(expr, config["prefer"])
    extra = config["texts"].get(name, [])
    texts = [str(ROOT / t) for t in extra] or [str(t) for t in license_texts(directory, expr, resolved)]
    if name in config["declared"]:
        texts = [{"inline": declared_notice(config["declared"][name], resolved)}]
    source = config["sources"].get(name, source)
    return {"name": name, "version": version, "distribution": sorted(set(dist)), "license": resolved,
            "upstream": upstream, "source": source, "texts": texts}


# --- rendering -----------------------------------------------------------

def read_text(path):
    if isinstance(path, dict):
        return path["inline"]
    data = Path(path).read_bytes()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    # Only line endings and trailing blanks are normalised; the words are verbatim.
    return "\n".join(line.rstrip() for line in text.splitlines()).rstrip("\n")


def render(components):
    components = sorted(components, key=lambda c: (c["name"].lower(), c["version"]))
    missing = [f"{c['name']} {c['version']}" for c in components if not c.get("texts")]
    if missing:
        fail("no license text for: " + ", ".join(missing) + "; add it to notices-config.json")
    ids, bodies = {}, []
    index, notices, sources = [], [], []
    for c in components:
        text_ids = []
        for path in c["texts"]:
            body = read_text(path)
            digest = hashlib.sha256(body.encode()).hexdigest()
            if digest not in ids:
                ids[digest] = f"LT-{len(ids) + 1:03d}"
                bodies.append((ids[digest], body))
            text_ids.append(ids[digest])
        dist = ", ".join(c["distribution"])
        index.append(f"{c['name']} | {c['version']} | {dist} | {c['license']} | {', '.join(text_ids)}")
        source = c.get("source")
        notices.append("\n".join([
            RULE, f"Component: {c['name']}", f"Version: {c['version']}", f"Distribution: {dist}",
            f"Upstream: {c['upstream']}", f"Source: {source['url'] if source else c['upstream']}",
            f"Applicable license: {c['license']}", f"License text: {', '.join(text_ids)}",
            f"Modifications: {(source or {}).get('modifications', 'Unmodified upstream source')}",
            "", "See the license text IDs above in LICENSE TEXTS."]))
        if COPYLEFT.search(c["license"]):
            if not source:
                fail(f"{c['name']} {c['version']} needs a source entry in notices-config.json")
            sources.append("\n".join([
                f"Component and version: {c['name']} {c['version']}", f"License: {c['license']}",
                f"Source: {source['url']}", f"Additional patches: {source['patches']}",
                f"Modifications by Agent Board: {source['modifications']}", f"Build information: {source['build']}",
                f"Checksum: {source['checksum']}"] + [f"Related source: {u}" for u in source.get("also", [])]))
    parts = [HEADER, "COMPONENT INDEX\nName | Version | Distribution | Applicable license | License text ID",
             "\n".join(index), "\nCOMPONENT NOTICES", "\n\n".join(notices), "\nLICENSE TEXTS", RULE,
             "\n\n".join(f"License text ID: {i}\n{b}\n" for i, b in bodies), "SOURCE AVAILABILITY", RULE,
             "\n\n".join(sources), "\nThe source code identified in this section is available under the component's\n"
             "license stated above. Follow the source links to obtain the corresponding\n"
             "source code, including any listed modifications.\n"]
    return "\n".join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--stdout", action="store_true")
    parser.add_argument("--components")
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if args.components:
        components = json.loads(Path(args.components).read_text(encoding="utf-8"))
    else:
        components = rust_components(config) + web_components(config) + [toolchain_component()]
        components += config["embedded"]
    text = render(components)
    if args.stdout:
        sys.stdout.write(text)
    elif args.check:
        if not OUT.is_file() or OUT.read_bytes() != text.encode("utf-8"):
            fail("THIRD_PARTY_NOTICES.txt is out of date; run scripts/release/generate-notices.py")
    else:
        OUT.write_bytes(text.encode("utf-8"))


if __name__ == "__main__":
    main()
