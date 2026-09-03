/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdfjs-dist', 'pdf-lib'],

  // pdf.js reaches for its worker module by path at runtime. Nothing imports it
  // statically, so the tracer cannot see it and the serverless bundle ships
  // without it — which fails only in production, where it is most expensive to
  // discover. Naming it here keeps it in the bundle.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
  },
};
export default nextConfig;
