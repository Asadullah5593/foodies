#!/usr/bin/env python3
"""Build a minimal Word .docx (OOXML) using only the standard library."""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


def p(text: str, bold: bool = False) -> str:
    t = escape(text, {"'": "&apos;", '"': "&quot;"})
    if bold:
        return (
            f'<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>'
            f'<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
        )
    return (
        f'<w:p><w:pPr><w:spacing w:after="80"/></w:pPr>'
        f'<w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
    )


def bullet(text: str) -> str:
    t = escape(text, {"'": "&apos;", '"': "&quot;"})
    return (
        "<w:p><w:pPr><w:pStyle w:val=\"BodyText\"/><w:ind w:left=\"720\" w:hanging=\"360\"/>"
        "</w:pPr><w:r><w:t xml:space=\"preserve\">• </w:t></w:r>"
        f'<w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
    )


def build_document_xml() -> str:
    blocks: list[str] = []
    blocks.append(p("Weekly status summary", bold=True))
    blocks.append(p("Rough Foodie — delivery, operations, and mobile", bold=False))
    blocks.append(p("Date: fill in as needed for your report week.", bold=False))
    blocks.append(p("", bold=False))

    blocks.append(p("What was achieved", bold=True))
    blocks.append(
        bullet(
            "Automatic delivery rider assignment using strict round-robin when "
            "kitchen status moves from placed or accepted to preparing."
        )
    )
    blocks.append(
        bullet(
            "Rider check-in, check-out, and break (pause while checked in) so "
            "operations know who is on duty."
        )
    )
    blocks.append(
        bullet(
            "Assignment considers fresh rider heartbeat and location, check-in at "
            "the correct branch, position within the branch delivery radius, and "
            "limits on how many active deliveries a rider may carry (with optional "
            "quality thresholds when configured)."
        )
    )
    blocks.append(
        bullet(
            "If no rider qualifies, orders can remain unassigned; admin can retry "
            "automatic assignment after fixing riders or branch settings."
        )
    )
    blocks.append(
        bullet(
            "Branch location and delivery radius configuration so distance-based "
            "rules work correctly."
        )
    )
    blocks.append(
        bullet(
            "Inventory and procurement admin flow refresh: clearer paths from "
            "purchase request through purchase order to goods receipt (GRN), with "
            "improved status visibility and filters for day-to-day operations."
        )
    )
    blocks.append(
        bullet(
            "Inventory workspace improvements across stock on hand, movements, "
            "transfers, adjustments, items, units of measure, vendors, and related "
            "operational views."
        )
    )
    blocks.append(
        bullet(
            "Purchase order receipt status aligned with posted receipts (including "
            "partial receipt and closed states)."
        )
    )
    blocks.append(
        bullet(
            "Internal documentation for order assignment, rider HRM, dispatch, and "
            "payroll-related operating procedures."
        )
    )

    blocks.append(p("Mobile app update (as communicated)", bold=True))
    blocks.append(bullet("Map integration."))
    blocks.append(bullet("Rider tracking."))
    blocks.append(bullet("Kiosk screens."))

    blocks.append(p("What we are working on", bold=True))
    blocks.append(
        bullet(
            "Hardening, QA, and release alignment for dispatch, rider attendance, "
            "and related backend and admin features."
        )
    )
    blocks.append(
        bullet(
            "Further refinement of inventory and procurement based on branch UAT "
            "feedback."
        )
    )
    blocks.append(
        bullet(
            "Consumer web experience improvements (e.g. menu browsing and item "
            "detail)."
        )
    )
    blocks.append(
        bullet(
            "Mobile: continued integration and QA for maps, live rider tracking, "
            "and kiosk flows against production APIs."
        )
    )

    blocks.append(p("What is remaining / next steps", bold=True))
    blocks.append(
        bullet(
            "End-to-end QA of auto-assignment under real network, GPS, and branch "
            "radius scenarios."
        )
    )
    blocks.append(
        bullet(
            "Operations training on branch map settings and retry auto-assign for "
            "unassigned delivery orders."
        )
    )
    blocks.append(
        bullet(
            "Close out open UAT items for inventory, procurement, and mobile "
            "rollout (track specific tickets in your project board)."
        )
    )
    blocks.append(
        bullet(
            "Mobile store rollout: device testing, kiosk hardware sign-off, and "
            "phased deployment as applicable."
        )
    )

    body = "".join(blocks)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>"""


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""

RELS_ROOT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>
"""


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "WEEKLY_STATUS_SUMMARY.docx"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS_ROOT)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/document.xml", build_document_xml())
        z.writestr("word/styles.xml", STYLES)
    print(out)


if __name__ == "__main__":
    main()
