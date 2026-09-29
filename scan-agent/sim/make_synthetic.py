"""Tiny synthetic page set for smoke tests (real runs use corpus/)."""
from PIL import Image, ImageDraw, ImageFont
import random, os
OUT = os.path.join(os.path.dirname(__file__), "synthetic")
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Supplemental/Courier New.ttf", s)

def page(name, lines, rot=0.6):
    im = Image.new("L", (1700, 2200), 245)
    d = ImageDraw.Draw(im)
    y = 150
    for size, text in lines:
        d.text((150, y), text, font=F(size), fill=20)
        y += int(size * 1.7)
    im = im.rotate(rot, fillcolor=235, resample=Image.BICUBIC)
    im.convert("RGB").save(os.path.join(OUT, name), quality=85)

page("permit-1.jpg", [(56, "CITY OF MILLBROOK"), (44, "BUILDING PERMIT"), (32, "Permit No: BP-2019-0412"),
    (32, "Issue Date: April 12, 2019"), (32, "Parcel: 123-456-789"), (32, "Owner: SMITH, JOHN A."),
    (32, "Site: 44 Orchard Lane, Millbrook"), (32, "Work: Detached garage, 24x30 ft"), (32, "Valuation: $38,500.00"),
    (28, ""), (28, "Page 1 of 2")])
page("permit-2.jpg", [(32, "BP-2019-0412 (continued)"), (32, "Contractor: Ridgeline Builders LLC"),
    (32, "License: RB-88213"), (32, "Conditions: setback 10 ft from rear line"), (32, "Approved: M. Alvarez, Building Official"),
    (28, ""), (28, "Page 2 of 2")], rot=-0.4)
page("inspection.jpg", [(44, "CITY OF MILLBROOK - INSPECTION REPORT"), (32, "Permit: BP-2019-0412"), (32, "Date: 06/03/2019"),
    (32, "Inspection: Footing"), (32, "Result: PASS"), (32, "Owner: John Smith"), (32, "Inspector: D. Okafor")])
page("invoice.jpg", [(44, "ACME PAVING CO."), (32, "INVOICE #4471"), (32, "Date: 2019-07-18"), (32, "Bill to: J. Smith, 44 Orchard Ln"),
    (32, "Driveway sealcoat .............. $4,210.00"), (32, "TOTAL DUE: $4,210.00")])
Image.new("RGB", (1700, 2200), (244, 244, 244)).save(os.path.join(OUT, "blank.jpg"), quality=85)
