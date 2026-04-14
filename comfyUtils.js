// comfyUtils.js — ComfyUI 공통 유틸
// buildComfyWorkflow는 index.js와 poll-and-generate.js에서 공유 사용

function buildComfyWorkflow(positivePrompt, modelName) {
  const ckpt = modelName || process.env.SD_MODEL_NAME || 'v1-5-pruned-emaonly.safetensors';
  const negativePrompt = 'ugly, blurry, low quality, watermark, text, deformed, extra limbs';
  const seed = Math.floor(Math.random() * 2 ** 32);
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model:        ['1', 0],
        positive:     ['2', 0],
        negative:     ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps:        20,
        cfg:          7,
        sampler_name: 'euler',
        scheduler:    'normal',
        denoise:      1.0,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'yoissue' },
    },
  };
}

module.exports = { buildComfyWorkflow };
