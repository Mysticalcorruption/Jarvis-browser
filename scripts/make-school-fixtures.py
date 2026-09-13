from pathlib import Path
from zipfile import ZipFile
from reportlab.pdfgen import canvas

root = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
root.mkdir(parents=True, exist_ok=True)
text = 'Biology lesson: cells contain a nucleus, cytoplasm and a cell membrane.'
pdf = canvas.Canvas(str(root / 'biology.pdf'))
pdf.drawString(72, 720, text)
pdf.save()
with ZipFile(root / 'biology.docx', 'w') as doc:
    doc.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    doc.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    doc.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>')
