import { initializeReaderFonts } from './reader-fonts';
import { initializeExedraFonts } from './exedra-fonts';

/** A settled fallback is allowed on a font error, but never publish the page
 * before the user's selected font requests have even started. */
export async function prepareDisplayFonts(pixelFont: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await Promise.allSettled([initializeReaderFonts(), initializeExedraFonts()]);
        if (pixelFont) await Promise.allSettled([
          document.fonts.load('12px "MagiReaderNightPixelSC"', 'LOADING 正文'),
          document.fonts.load('12px "MagiReaderNightPixelJP"', 'あいうえお'),
        ]);
        await document.fonts.ready;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('字体加载超时，请检查连接后重试。')), 30000); }),
    ]);
  } finally { clearTimeout(timer); }
}
