import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { analyze } from '../lib/analyze.mjs';

// Six runs hidden by ONE technique (white on white) -> what does the headline finding say?
const pdf = await PDFDocument.create();
const page = pdf.addPage([595,842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('ACME GMBH  ·  Rechnung  ·  accounts@acme-technik.de', {x:50,y:780,size:10,font});
page.drawText('TOTAL DUE EUR 4,100.00', {x:50,y:760,size:10,font});
page.drawText('IBAN            DE89 3704 0044 0532 0130 00', {x:50,y:740,size:10,font});
for (let i=0;i<6;i++) page.drawText('Hidden instruction number '+i+' for the automated reader.', {x:50,y:700-i*14,size:9,font,color:rgb(1,1,1)});
const r = await analyze(await pdf.save(), {}, { withEvidence:false });
console.log('FINDINGS:'); r.findings.forEach(f=>console.log('  * '+f));
console.log('VERDICT:', JSON.stringify(r.verdict));
