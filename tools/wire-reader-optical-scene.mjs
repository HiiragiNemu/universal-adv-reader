import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'reports/verification/reader-inheritance-20261012/atom03');
const require = createRequire(path.join(root, 'apps/classic-reader/package.json'));
const ts = require('typescript');
const once = (text, from, to) => {
  if (text.split(from).length !== 2) throw Error(`Expected one wiring anchor: ${from.slice(0, 130)}`);
  return text.replace(from, to);
};
const patch = (file, transform) => {
  const target = path.join(dir, 'modified', file);
  const old = fs.readFileSync(target, 'utf8'), crlf = old.includes('\r\n');
  const text = transform(old.replaceAll('\r\n', '\n'));
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (parsed.parseDiagnostics.length) throw Error(`${file}: ${parsed.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText, '\n')).join('; ')}`);
  fs.writeFileSync(target, crlf ? text.replaceAll('\n', '\r\n') : text);
};
const sharedImports = `import LoadingScreen from '@/components/LoadingScreen';
import IOSViewportHost from '@/components/IOSViewportHost';
import IOSHeaderSurface from '@/components/IOSHeaderSurface';
import { ReaderFilmSurface, ReaderTubeSurface } from '@/components/RetroDisplaySurface';
`;

for (const file of ['app/page.tsx', 'components/ClassicHome.tsx']) patch(file, text => {
  text = once(text, "import Link from 'next/link';", "import Link from 'next/link';\n" + sharedImports + "import '@/app/home-optical-refinements.css';");
  text = once(text, `  if (loading) {
    return (
      <div className="flex h-screen h-[100dvh] items-center justify-center opacity-50">
        数据加载中…
      </div>
    );
  }`, '  if (loading) return <LoadingScreen />;');
  text = once(text, '  return (\n    <div\n      data-theme=', '  return (\n    <IOSViewportHost><div\n      id="magi-home-display"\n      data-theme=');
  text = once(text, '    >\n      <aside\n', `    >
      {theme === 'frost' && <ReaderFilmSurface />}
      <ReaderTubeSurface theme={theme} />
      <div className="magi-scene-content">
      <aside
`);
  text = once(text, '        <header\n', '        <IOSHeaderSurface layer={10}>\n        <header\n');
  text = once(text, '        </header>', '        </header>\n        </IOSHeaderSurface>');
  const end = '      />\n    </div>\n  );\n}';
  const at = text.lastIndexOf(end);
  if (at < 0) throw Error(`${file}: missing scene end`);
  return text.slice(0, at) + text.slice(at).replace(end, '      />\n      </div>\n    </div></IOSViewportHost>\n  );\n}');
});

patch('app/reader/[id]/page.tsx', text => {
  text = once(text, "import Link from 'next/link';", "import Link from 'next/link';\n" + sharedImports + "import ReaderStyleScope from '@/components/ReaderStyleScope';");
  text = once(text, '  READER_FONT_SIZE_MAX,', '  isReaderRulerEnabled,\n  READER_FONT_SIZE_MAX,');
  text = once(text, `  if (loading) {
    return (
      <div className="flex h-screen h-[100dvh] items-center justify-center opacity-60">
        正在读取剧情…
      </div>
    );
  }`, '  if (loading) return <LoadingScreen />;');
  text = once(text, "  return (\n    <div\n      data-mobile-sidebar-open=", `  return (
    <IOSViewportHost><div
      id="magi-reader-display"
      data-reader-mode={isEditMode ? 'edit' : 'read'}
      data-reading-ruler={isReaderRulerEnabled(readerDisplayPreferences, theme) ? 'on' : 'off'}
      data-mobile-sidebar-open=`);
  text = once(text, '    >\n      <Sidebar\n', `    >
      <ReaderStyleScope />
      {theme === 'frost' && <ReaderFilmSurface />}
      <ReaderTubeSurface theme={theme} />
      <div className="magi-scene-content">
      <Sidebar
`);
  text = once(text, '        <div className="magi-reader-header-stack relative z-20 shrink-0">', '        <IOSHeaderSurface layer={36}>\n        <div className="magi-reader-header-stack relative z-20 shrink-0">');
  text = once(text, '        </div>\n\n        {!loadError && (\n          <DraggableReaderWidget', '        </div>\n        </IOSHeaderSurface>\n\n        {!loadError && (\n          <DraggableReaderWidget');
  text = once(text, '      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} theme={theme} />\n    </div>', '      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} theme={theme} />\n      </div>\n    </div></IOSViewportHost>');
  text = once(text, "  language: 'cn' | 'jp';\n}) {\n  const displayedSpeaker", "  language: 'cn' | 'jp';\n}) {\n  const { nameColorsEnabled } = useGlobal();\n  const displayedSpeaker");
  text = once(text, 'style={{ color: speakerColor(displayedSpeaker) }}', 'style={{ color: nameColorsEnabled ? speakerColor(displayedSpeaker) : undefined }}');
  return text;
});

patch('app/providers.tsx', text => {
  text = once(text, 'import DisplayStartupCover', "import { usePathname } from 'next/navigation';\nimport DisplayStartupCover");
  text = once(text, '  const iosWebKit = useIOSWebKit();', `  const pathname = usePathname();
  // Only adopted optical routes own the startup gate. Historical utility pages
  // without a display-readiness marker must remain reachable during migration.
  const opticalRoute = pathname === '/' || pathname === '/apps/web' || pathname === '/apps/web/'
    || pathname.startsWith('/reader/') || pathname.startsWith('/review/');
  const iosWebKit = useIOSWebKit();`);
  return once(text, '      <DisplayStartupCover />', '      {opticalRoute && <DisplayStartupCover />}');
});
const manifestPath = path.join(dir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const entry of manifest.entries) entry.modifiedBytes = fs.statSync(path.join(dir, 'modified', entry.file)).size;
manifest.adaptations = ['Preserve generic default category and product metadata', 'Mount exact shared optical stack in both retained home implementations and read/edit route', 'Keep generic voice/content adapters and reader event handlers unchanged', 'Limit startup cover to routes with optical readiness ownership', 'Name-color setting controls existing generic speaker chips'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`WIRED ${manifest.entries.length} candidate files; retained route TSX parses`);
