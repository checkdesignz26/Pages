#!/usr/bin/env python3
"""Generates the new Etsy digital-download PDF: a batch of unique access
codes instead of the single fixed "82667" the old PDF listed, matching its
branding/tone. Reads the code list from etsy-codes-list.json (produced by
generate-etsy-codes.js - run that first).
"""
import json
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

HERE = os.path.dirname(os.path.abspath(__file__))
CODES_PATH = os.path.join(HERE, 'etsy-codes-list.json')
OUT_PATH = os.path.join(HERE, 'patternpages-access-key.pdf')

INK = colors.HexColor('#2a2438')
MUTED = colors.HexColor('#5c5570')
ACCENT = colors.HexColor('#8a5cf6')
LINK = colors.HexColor('#7c5cff')
APP_URL = 'https://ppages.checkdesignz.com'

with open(CODES_PATH) as f:
    codes = json.load(f)['codes']

styles = {
    'h1': ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=20, textColor=INK, spaceAfter=14, leading=24),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=11.5, textColor=INK, spaceAfter=12, leading=16),
    'link': ParagraphStyle('link', fontName='Helvetica-Bold', fontSize=12, textColor=LINK, spaceAfter=14, leading=16),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=9.5, textColor=MUTED, spaceAfter=10, leading=13),
    'brand': ParagraphStyle('brand', fontName='Helvetica-BoldOblique', fontSize=15, textColor=INK, alignment=1),
    'tagline': ParagraphStyle('tagline', fontName='Helvetica', fontSize=9.5, textColor=MUTED, alignment=1, spaceBefore=4),
    'note': ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=9.5, textColor=MUTED, spaceBefore=10, leading=13),
}

doc = SimpleDocTemplate(
    OUT_PATH, pagesize=letter,
    leftMargin=0.85 * inch, rightMargin=0.85 * inch,
    topMargin=0.9 * inch, bottomMargin=0.8 * inch,
)

story = []
story.append(Paragraph('Welcome to Pattern Pages', styles['h1']))
story.append(Paragraph('Thank you for choosing Pattern Pages', styles['body']))
story.append(Paragraph(
    'Create beautiful Etsy listings, social media graphics, showcases and more '
    '— all in one simple creative workspace.',
    styles['body']))
story.append(Paragraph('Your creative workspace is ready', styles['body']))
story.append(Paragraph(f'<link href="{APP_URL}">Open pattern pages</link>', styles['link']))
story.append(Paragraph(
    'Your access key unlocks Pattern Pages and keeps you signed in for an extended period.',
    styles['body']))
story.append(Paragraph(
    'Pick <b>any one</b> unused code from the list below and enter it the first time you open '
    'Pattern Pages — it’s yours to keep. If the one you picked doesn’t work '
    '(rare, but it means someone else grabbed it first), just try another from the list.',
    styles['body']))
story.append(Spacer(1, 6))

COLS = 6
rows = [codes[i:i + COLS] for i in range(0, len(codes), COLS)]
table = Table(rows, colWidths=[(doc.width) / COLS] * COLS, hAlign='LEFT')
table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, -1), 'Courier-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 10.5),
    ('TEXTCOLOR', (0, 0), (-1, -1), INK),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e4defa')),
    ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, colors.HexColor('#f7f4fe')]),
]))
story.append(table)

story.append(Spacer(1, 14))
story.append(Paragraph(
    'You won’t need to enter your key every time you visit. When your access expires, '
    'you’ll simply be asked to enter your access key again.',
    styles['body']))
story.append(Paragraph('Your first time here?', styles['body']))
story.append(Paragraph(
    'When you open Pattern Pages for the first time, the Quick Start Guide will appear '
    'automatically and walk you through the basics.',
    styles['body']))
story.append(Paragraph('Need a little help?', styles['body']))
story.append(Paragraph('I hope you enjoy working in Pattern Pages!', styles['body']))
story.append(Paragraph(
    'And if you ever need some help along the way, you can always reach out. I’m always '
    'happy to help.',
    styles['body']))

story.append(Spacer(1, 22))
story.append(HRFlowable(width='100%', thickness=0.6, color=colors.HexColor('#e4defa')))
story.append(Spacer(1, 12))
story.append(Paragraph('Check Designz', styles['brand']))
story.append(Paragraph('Create • Design • Showcase • Export', styles['tagline']))
story.append(Paragraph(
    f'Each code above works once. Generated for this listing’s digital download — '
    f'{len(codes)} codes included.',
    styles['note']))

doc.build(story)
print(f'Wrote {OUT_PATH} with {len(codes)} codes across {len(rows)} table rows.')
