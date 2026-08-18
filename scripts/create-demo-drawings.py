from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "demo-drawings"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")


def setup(pdf):
    if FONT_PATH.exists():
        pdfmetrics.registerFont(TTFont("AppleGothic", str(FONT_PATH)))
        font = "AppleGothic"
    else:
        font = "Helvetica"
    pdf.setFont(font, 12)
    return font


def title(pdf, font, value, subtitle):
    width, height = landscape(A4)
    pdf.setFillColor(colors.HexColor("#183d2d"))
    pdf.setFont(font, 20)
    pdf.drawString(42, height - 48, value)
    pdf.setFillColor(colors.HexColor("#597064"))
    pdf.setFont(font, 10)
    pdf.drawString(42, height - 68, subtitle)
    pdf.setStrokeColor(colors.HexColor("#8ba99b"))
    pdf.line(42, height - 78, width - 42, height - 78)
    return width, height


def dimension(pdf, font, start, end, text, offset=16, vertical=False):
    pdf.setStrokeColor(colors.HexColor("#236d4a"))
    pdf.setFillColor(colors.HexColor("#236d4a"))
    pdf.setLineWidth(1)
    if vertical:
        x = start[0] + offset
        pdf.line(x, start[1], x, end[1])
        pdf.line(x - 5, start[1] + 7, x + 5, start[1] - 7)
        pdf.line(x - 5, end[1] + 7, x + 5, end[1] - 7)
        pdf.saveState()
        pdf.translate(x + 10, (start[1] + end[1]) / 2)
        pdf.rotate(90)
        pdf.setFont(font, 11)
        pdf.drawCentredString(0, 0, text)
        pdf.restoreState()
    else:
        y = start[1] + offset
        pdf.line(start[0], y, end[0], y)
        pdf.line(start[0] - 7, y - 5, start[0] + 7, y + 5)
        pdf.line(end[0] - 7, y - 5, end[0] + 7, y + 5)
        pdf.setFont(font, 11)
        pdf.drawCentredString((start[0] + end[0]) / 2, y + 8, text)


def floor_plan(path):
    pdf = canvas.Canvas(str(path), pagesize=landscape(A4))
    font = setup(pdf)
    width, height = title(pdf, font, "시연용 건물 평면도", "DEMO FLOOR PLAN · 모든 치수 단위 mm")
    x, y, w, h = 180, 155, 360, 270
    pdf.setStrokeColor(colors.HexColor("#183d2d"))
    pdf.setLineWidth(3)
    pdf.rect(x, y, w, h)
    pdf.setLineWidth(1.5)
    pdf.line(x + w * .55, y, x + w * .55, y + h)
    pdf.line(x, y + h * .48, x + w, y + h * .48)
    pdf.setFont(font, 12)
    pdf.setFillColor(colors.HexColor("#345a48"))
    pdf.drawCentredString(x + w * .28, y + h * .72, "휴게 공간")
    pdf.drawCentredString(x + w * .77, y + h * .72, "화장실")
    pdf.drawCentredString(x + w * .5, y + h * .23, "현관 / 창호")
    pdf.setStrokeColor(colors.HexColor("#c66f35"))
    pdf.setLineWidth(4)
    pdf.line(x + 115, y, x + 185, y)
    pdf.line(x + 285, y + h, x + 340, y + h)
    dimension(pdf, font, (x, y), (x + w, y), "8,000", -34)
    dimension(pdf, font, (x, y), (x, y + h), "6,000", -40, vertical=True)
    pdf.setFont(font, 9)
    pdf.setFillColor(colors.HexColor("#6a7f74"))
    pdf.drawString(570, 365, "외벽: 샌드위치패널 75T")
    pdf.drawString(570, 342, "주 출입문: 1,000 × 2,100")
    pdf.drawString(570, 319, "창호: 1,200 × 1,000")
    pdf.drawString(570, 296, "도면 번호: A-101")
    pdf.showPage()
    pdf.save()


def elevation(path):
    pdf = canvas.Canvas(str(path), pagesize=landscape(A4))
    font = setup(pdf)
    width, height = title(pdf, font, "시연용 정면도", "DEMO FRONT ELEVATION · 벽체 높이 확인")
    x, y, w, h = 195, 150, 390, 210
    pdf.setStrokeColor(colors.HexColor("#183d2d"))
    pdf.setLineWidth(3)
    pdf.rect(x, y, w, h)
    pdf.setStrokeColor(colors.HexColor("#5f7d6d"))
    pdf.setLineWidth(1.5)
    for col in range(1, 5):
        pdf.line(x + col * w / 5, y, x + col * w / 5, y + h)
    pdf.setStrokeColor(colors.HexColor("#c66f35"))
    pdf.setLineWidth(3)
    pdf.rect(x + 70, y, 62, 150)
    pdf.rect(x + 230, y + 75, 95, 78)
    dimension(pdf, font, (x, y), (x, y + h), "2,800", 45, vertical=True)
    dimension(pdf, font, (x, y), (x + w, y), "8,000", -34)
    pdf.setFillColor(colors.HexColor("#345a48"))
    pdf.setFont(font, 11)
    pdf.drawString(615, 342, "처마 높이: 2,800")
    pdf.drawString(615, 318, "출입문 D-01: 1,000 × 2,100")
    pdf.drawString(615, 294, "창호 W-01: 1,200 × 1,000")
    pdf.drawString(615, 270, "도면 번호: A-201")
    pdf.showPage()
    pdf.save()


def schedule(path):
    pdf = canvas.Canvas(str(path), pagesize=landscape(A4))
    font = setup(pdf)
    width, height = title(pdf, font, "시연용 창호·마감표", "DEMO WINDOW / FINISH SCHEDULE")
    x, y = 70, 160
    columns = [110, 160, 155, 150, 130]
    headers = ["구분", "규격(mm)", "수량", "적용 위치", "비고"]
    rows = [
        ["D-01 출입문", "1,000 × 2,100", "1개", "정면", "문"],
        ["W-01 창호", "1,200 × 1,000", "2개", "정면", "창호"],
        ["외벽 판넬", "75T", "산출", "외벽", "샌드위치패널"],
    ]
    table_width = sum(columns)
    row_h = 46
    pdf.setStrokeColor(colors.HexColor("#9db7a9"))
    for index in range(5):
        pdf.line(x, y + index * row_h, x + table_width, y + index * row_h)
    position = x
    for column in columns:
        pdf.line(position, y, position, y + 4 * row_h)
        position += column
    pdf.line(x + table_width, y, x + table_width, y + 4 * row_h)
    pdf.setFillColor(colors.HexColor("#dfeee4"))
    pdf.rect(x, y + 3 * row_h, table_width, row_h, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#183d2d"))
    pdf.setFont(font, 11)
    position = x
    for header, column in zip(headers, columns):
        pdf.drawCentredString(position + column / 2, y + 3 * row_h + 16, header)
        position += column
    for row_index, row in enumerate(rows):
        position = x
        text_y = y + (2 - row_index) * row_h + 16
        for value, column in zip(row, columns):
            pdf.drawCentredString(position + column / 2, text_y, value)
            position += column
    pdf.setFillColor(colors.HexColor("#5c7368"))
    pdf.setFont(font, 10)
    pdf.drawString(70, 120, "발주 수량은 벽체 길이·높이에서 창호 면적을 차감한 뒤 계산합니다.")
    pdf.showPage()
    pdf.save()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    floor_plan(OUTPUT / "demo-floor-plan.pdf")
    elevation(OUTPUT / "demo-elevation.pdf")
    schedule(OUTPUT / "demo-window-schedule.pdf")


if __name__ == "__main__":
    main()
