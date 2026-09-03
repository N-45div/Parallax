import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractViews } from '../lib/views.mjs';

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const t = (s, y, color, size=10) => page.drawText(s, { x: 50, y, size, font, color });

t('Ordinary black body text on a plain invoice line.', 700, rgb(0,0,0));
t('Muted grey label 0.45 grey — very common on real invoices.', 680, rgb(0.45,0.45,0.45));
t('Light grey footnote 0.6 grey.', 660, rgb(0.6,0.6,0.6));
t('Pale grey disclaimer 0.8 grey.', 640, rgb(0.8,0.8,0.8));
t('Brand blue heading 0.05/0.35/0.62.', 620, rgb(0.05,0.35,0.62));
t('Red overdue stamp 0.8/0.1/0.1.', 600, rgb(0.8,0.1,0.1));
t('Green paid 0.1/0.55/0.25.', 580, rgb(0.1,0.55,0.25));
t('Genuinely hidden white on white.', 560, rgb(1,1,1));
t('Nearly black 1/255 grey.', 540, rgb(1/255,1/255,1/255));

const bytes = await pdf.save();
const v = await extractViews(bytes);
for (const r of v.runs) {
  console.log((r.concealed ? 'CONCEALED ' : 'visible   ') + JSON.stringify(r.text.slice(0,45)).padEnd(50) + ' fill=' + Array.from(r.fill).join(',') + '  ' + (r.reasons.join(' | ')||''));
}
