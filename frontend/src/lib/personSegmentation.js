// All runtime/model assets are served by our app. Video frames stay in-browser.
import wasmLoaderPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import wasmBinaryPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import fallbackLoaderPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url';
import fallbackBinaryPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url';

export async function createPersonSegmenter() {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const simd = await FilesetResolver.isSimdSupported();
  return ImageSegmenter.createFromOptions({
    wasmLoaderPath: simd ? wasmLoaderPath : fallbackLoaderPath,
    wasmBinaryPath: simd ? wasmBinaryPath : fallbackBinaryPath,
  }, {
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite` },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}
