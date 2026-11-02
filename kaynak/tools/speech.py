"""Seslendirme köprüsü. Metin komut satırına değil UTF-8 JSON dosyasına alınır."""
import asyncio
import json
import sys
from pathlib import Path
import edge_tts


async def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if request.get("op") == "voices":
        voices = await edge_tts.list_voices()
        print(json.dumps([{"id": v["ShortName"], "name": v["FriendlyName"],
                           "locale": v["Locale"], "gender": v["Gender"]}
                          for v in voices], ensure_ascii=False))
        return
    text = request["text"].strip()
    if not text:
        raise ValueError("Jenerik metni boş olamaz.")
    voice = request.get("voice", "tr-TR-EmelNeural")
    rate = f'{int(request.get("rate", 0)):+d}%'
    pitch = f'{int(request.get("pitch", 0)):+d}Hz'
    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(request["output"])
    print(json.dumps({"ok": True, "output": request["output"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        # Metin, kimlik bilgisi ve ham ağ başlıkları hata çıktısına taşınmaz.
        print(json.dumps({"ok": False, "error": type(exc).__name__}, ensure_ascii=False))
        sys.exit(1)
