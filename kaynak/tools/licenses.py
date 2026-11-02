"""Paketlerin lisanslarını ve tam sürümlerini dağıtımın yanına kopyalar."""
from importlib.metadata import distributions
from pathlib import Path
import json
import shutil

out = Path("vendor/licenses/python")
out.mkdir(parents=True, exist_ok=True)
packages = []
for dist in distributions():
    name = dist.metadata["Name"]
    packages.append({"name": name, "version": dist.version, "home": dist.metadata.get("Home-page", "")})
    for file in dist.files or []:
        if any(word in str(file).lower() for word in ("license", "copying")):
            source = dist.locate_file(file)
            if source.is_file():
                target = out / name / Path(str(file)).name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
Path("vendor/licenses/python-packages.json").write_text(json.dumps(packages, indent=2), encoding="utf-8")
Path("tools/requirements-lock.txt").write_text("\n".join(f'{p["name"]}=={p["version"]}' for p in sorted(packages, key=lambda p: p["name"])) + "\n", encoding="utf-8")
print(f"{len(packages)} Python paketinin lisans/sürüm kaydı hazır.")
