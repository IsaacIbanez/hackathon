"""Printable test documents with invented data, to photograph with the camera (T13, api/fixtures/real/).

    scanner\\pdf\\.venv\\Scripts\\python scanner\\pdf\\samples\\make_print_samples.py

Writes scanner/pdf/samples/print/*.pdf (A4). Print them, photograph them with the MX Brio and send the
photos to the reading service. Every name, number and company is made up; each page says so in its footer.
The text imitates real Spanish/Catalan documents, so it stays in Spanish/Catalan.
"""

from __future__ import annotations

import math
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent / "print"
W, H = A4
MARGIN = 22 * mm
FOOTER = "Documento de prueba con datos inventados (LauzHack 2026). No es un documento real."


def _wrap(text: str, font: str, size: float, width: float) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if stringWidth(candidate, font, size) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    return lines + [line] if line else lines


def _paragraph(c, text: str, y: float, size: float = 11, font: str = "Helvetica", leading: float = 1.35) -> float:
    c.setFont(font, size)
    for line in _wrap(text, font, size, W - 2 * MARGIN):
        c.drawString(MARGIN, y, line)
        y -= size * leading
    return y - size * 0.6


def _letterhead(c, name: str, address: str) -> None:
    c.setFillColorRGB(0.1, 0.3, 0.6)
    c.circle(MARGIN + 7 * mm, H - 22 * mm, 7 * mm, fill=1, stroke=0)          # logo
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(MARGIN + 7 * mm, H - 24.5 * mm, name[0])
    c.setFillColorRGB(0.1, 0.3, 0.6)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(MARGIN + 17 * mm, H - 20 * mm, name)
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN + 17 * mm, H - 25 * mm, address)
    c.setFillColorRGB(0, 0, 0)


def _signature(c, x: float, y: float) -> None:
    """A made-up handwritten stroke (blue pen)."""
    c.setStrokeColorRGB(0.1, 0.15, 0.55)
    c.setLineWidth(1.3)
    p = c.beginPath()
    for i in range(121):
        t = i / 120 * 4 * math.pi
        px, py = x + t / (4 * math.pi) * 55 * mm, y + math.sin(t * 1.6) * 5 * mm * (1 - t / (5 * math.pi))
        p.moveTo(px, py) if i == 0 else p.lineTo(px, py)
    c.drawPath(p)
    c.setStrokeColorRGB(0, 0, 0)


def _footer(c) -> None:
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawCentredString(W / 2, 12 * mm, FOOTER)
    c.setFillColorRGB(0, 0, 0)


def renewal_letter(path: Path) -> None:
    """Insurance letter with a deadline and an amount (the demo story: explain it in plain words)."""
    c = canvas.Canvas(str(path), pagesize=A4)
    _letterhead(c, "Seguros Lumen S.A.", "Calle Ficticia 10, 08000 Barcelona · Tel. 900 000 000")
    c.setFont("Helvetica", 11)
    y = H - 45 * mm
    for line in ("Sra. Carmen Ruiz Prado", "Calle de los Almendros 7, 2.º B", "08999 Villaejemplo (Barcelona)"):
        c.drawString(W - MARGIN - 75 * mm, y, line)
        y -= 14
    y -= 20
    c.drawString(MARGIN, y, "Barcelona, 14 de noviembre de 2026")
    y -= 28
    c.setFont("Helvetica-Bold", 12)
    c.drawString(MARGIN, y, "Asunto: Renovación de su póliza de hogar n.º HG-2026-004512")
    y -= 26
    y = _paragraph(c, "Estimada clienta:", y)
    y = _paragraph(c, "Le informamos de que su póliza de seguro de hogar vence el 31 de diciembre de 2026. "
                      "Para mantener la cobertura sin interrupciones, la renovación se realizará de forma "
                      "automática salvo que nos comunique lo contrario antes del 15 de diciembre de 2026.", y)
    y = _paragraph(c, "La prima anual para el próximo periodo será de 284,60 euros, que se cargará en la cuenta "
                      "bancaria que figura en su póliza el día 2 de enero de 2027. Este importe incluye la "
                      "actualización del capital asegurado del continente y del contenido.", y)
    y = _paragraph(c, "Si desea modificar las coberturas o tiene cualquier duda, puede llamarnos al 900 000 000 "
                      "de lunes a viernes, de 9 a 18 horas, o escribirnos a clientes@seguroslumen.example.", y)
    y = _paragraph(c, "Atentamente,", y - 4)
    _signature(c, MARGIN, y - 18 * mm)
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN, y - 30 * mm, "Jorge Martín Vidal")
    c.drawString(MARGIN, y - 30 * mm - 13, "Departamento de Atención al Cliente")
    _footer(c)
    c.save()


def claim_form(path: Path) -> None:
    """Accident claim form with empty fields (pointing at a field and filling it by voice)."""
    c = canvas.Canvas(str(path), pagesize=A4)
    _letterhead(c, "Seguros Lumen S.A.", "Declaración de siniestro · Seguro de hogar")
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(W / 2, H - 45 * mm, "DECLARACIÓN DE SINIESTRO")
    y = H - 58 * mm
    y = _paragraph(c, "Rellene este formulario con letra clara y envíelo firmado en un plazo de 7 días desde "
                      "la fecha del siniestro. Los campos marcados con * son obligatorios.", y, size=10)
    fields = [("Nombre y apellidos del asegurado *", 1), ("Número de póliza *", 1), ("DNI / NIE *", 1),
              ("Teléfono de contacto", 1), ("Fecha del siniestro *", 1), ("Dirección del lugar del siniestro *", 1),
              ("Descripción de lo ocurrido *", 3)]
    c.setLineWidth(0.8)
    for label, rows in fields:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(MARGIN, y, label)
        y -= 6
        height = 9 * mm * rows
        c.rect(MARGIN, y - height, W - 2 * MARGIN, height)
        y -= height + 9 * mm
    c.setFont("Helvetica", 10)
    c.rect(MARGIN, y - 4, 4 * mm, 4 * mm)
    c.drawString(MARGIN + 7 * mm, y - 3, "Declaro que los datos son ciertos y autorizo su tratamiento para gestionar el siniestro.")
    y -= 16 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, y, "Fecha:")
    c.line(MARGIN + 14 * mm, y - 2, MARGIN + 60 * mm, y - 2)
    c.drawString(W / 2, y, "Firma del asegurado:")
    c.rect(W / 2, y - 30 * mm, W / 2 - MARGIN, 26 * mm)
    _footer(c)
    c.save()


def catalan_notice(path: Path) -> None:
    """Short Catalan notice with a table (Catalan OCR, columns)."""
    c = canvas.Canvas(str(path), pagesize=A4)
    _letterhead(c, "Aigües de Vilaexemple", "Plaça Major 1, 08998 Vilaexemple · Atenció al client 900 111 111")
    y = H - 50 * mm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(MARGIN, y, "Avís de rebut pendent de pagament")
    y -= 24
    y = _paragraph(c, "Benvolgut client, us informem que el rebut del subministrament d'aigua del tercer "
                      "trimestre de 2026 encara no s'ha pogut cobrar. Podeu pagar-lo abans del 20 de desembre "
                      "de 2026 per evitar recàrrecs.", y)
    rows = [("Concepte", "Període", "Import"), ("Quota de servei", "jul.-set. 2026", "18,40 €"),
            ("Consum d'aigua (32 m³)", "jul.-set. 2026", "41,15 €"), ("Clavegueram", "jul.-set. 2026", "9,80 €"),
            ("IVA (10 %)", "", "6,94 €"), ("Total a pagar", "", "76,29 €")]
    col = [MARGIN, MARGIN + 85 * mm, W - MARGIN - 30 * mm]
    for i, row in enumerate(rows):
        c.setFont("Helvetica-Bold" if i in (0, len(rows) - 1) else "Helvetica", 11)
        for x, cell in zip(col, row):
            c.drawString(x, y, cell)
        y -= 8
        c.setLineWidth(1.0 if i in (0, len(rows) - 2) else 0.3)
        c.line(MARGIN, y, W - MARGIN, y)
        y -= 14
    y -= 10
    y = _paragraph(c, "Podeu pagar a qualsevol oficina bancària amb aquest avís, per domiciliació o al web "
                      "aiguesvilaexemple.example amb el codi de client 0042-7781.", y)
    y = _paragraph(c, "Si ja l'heu pagat, no tingueu en compte aquest avís.", y)
    _footer(c)
    c.save()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, make in (("01-carta-renovacion", renewal_letter), ("02-formulario-siniestro", claim_form),
                       ("03-avis-rebut-ca", catalan_notice)):
        make(OUT / f"{name}.pdf")
        print(OUT / f"{name}.pdf")


if __name__ == "__main__":
    main()
