# Invoice PDF renderer

`html2pdf.bundle.min.js` is the unmodified browser distribution of html2pdf.js 0.14.0. It includes its PDF and HTML capture dependencies. License notices are retained next to the bundle. No external CDN is used at runtime.

The library renders the existing invoice paper for Send and PDF-only retry; email and Drive receive the same PDF bytes. The backend retains the deployed PDF layout as a fallback for older clients.

To reproduce the vendored files, install `html2pdf.js@0.14.0` using npm outside this checkout and copy `dist/html2pdf.bundle.min.js`, its accompanying `.LICENSE.txt`, and `LICENSE`.

Package integrity: `sha512-yvNJgE/8yru2UeGflkPdjW8YEY+nDH5X7/2WG4uiuSCwYiCp8PZ8EKNiTAa6HxJ1NjC51fZSIEq6xld5CADKBQ==`

Bundle SHA-256: `9563c45f032179c73454293a649929e60fc24c05a326e8ab2811cfa8f25c3607`
