// comfyUtils.js — ComfyUI 공통 유틸 (FLUX.1-dev)

function buildComfyWorkflow(positivePrompt) {
  const seed = Math.floor(Math.random() * 2 ** 32);

  return {
    // ── UNet 로드 (FLUX) ───────────────────────────────────
    '1': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name:    'flux1-dev.safetensors',
        weight_dtype: 'default',
      },
    },
    // ── CLIP 2개 로드 ──────────────────────────────────────
    '2': {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: 't5xxl_fp8_e4m3fn.safetensors',
        clip_name2: 'clip_l.safetensors',
        type:       'flux',
      },
    },
    // ── VAE 로드 ───────────────────────────────────────────
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },
    // ── Positive 프롬프트 ──────────────────────────────────
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['2', 0] },
    },
    // ── Empty 프롬프트 (FLUX는 negative 미사용) ────────────
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['2', 0] },
    },
    // ── FLUX Guidance ──────────────────────────────────────
    '6': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['4', 0], guidance: 3.5 },
    },
    // ── 1024×1024 Latent ───────────────────────────────────
    '7': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    // ── KSampler (FLUX 권장 설정) ──────────────────────────
    '8': {
      class_type: 'KSampler',
      inputs: {
        model:        ['1', 0],
        positive:     ['6', 0],
        negative:     ['5', 0],
        latent_image: ['7', 0],
        seed,
        steps:        20,
        cfg:          1.0,
        sampler_name: 'euler',
        scheduler:    'simple',
        denoise:      1.0,
      },
    },
    // ── VAE Decode ─────────────────────────────────────────
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['3', 0] },
    },
    // ── 저장 ───────────────────────────────────────────────
    '10': {
      class_type: 'SaveImage',
      inputs: { images: ['9', 0], filename_prefix: 'yoissue' },
    },
  };
}

module.exports = { buildComfyWorkflow };
