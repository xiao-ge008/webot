const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const projectRoot = process.cwd();
const mainEntry = path.join(projectRoot, 'src', 'main', 'electron-main.ts');
const out = path.join(projectRoot, 'dist-main', 'index.cjs');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const external = ['electron', ...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];

esbuild.build({
  entryPoints: [mainEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: out,
  external,
  sourcemap: false,
  banner: {
    js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    'process.env.VITE_DEV_SERVER_URL': JSON.stringify('http://localhost:5274'),
    'import.meta.url': 'import_meta_url',
  },
}).then(() => {
  console.log('esbuild ok');
}).catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
