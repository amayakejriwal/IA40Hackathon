"""vision_ocr.py <image> <out-base> → Apple Vision text recognition (accurate mode).
Writes <out-base>.txt (lines, top to bottom) and <out-base>.vision.json (lines with confidence and boxes)."""
import json, sys
import Quartz, Vision
from Foundation import NSURL

img, out = sys.argv[1], sys.argv[2]
src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(img), None)
cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
req = Vision.VNRecognizeTextRequest.alloc().init()
req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
req.setUsesLanguageCorrection_(True)
ok, err = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None).performRequests_error_([req], None)
if not ok:
    sys.exit(f"vision failed: {err}")
lines = []
for o in req.results() or []:
    c = o.topCandidates_(1)[0]
    b = o.boundingBox()
    lines.append({"text": c.string(), "conf": round(c.confidence(), 3),
                  "bbox": [round(b.origin.x, 4), round(1 - b.origin.y - b.size.height, 4), round(b.size.width, 4), round(b.size.height, 4)]})
lines.sort(key=lambda l: (round(l["bbox"][1], 2), l["bbox"][0]))
open(f"{out}.txt", "w").write("\n".join(l["text"] for l in lines) + "\n")
json.dump({"engine": "apple-vision", "lines": lines}, open(f"{out}.vision.json", "w"), indent=1)
