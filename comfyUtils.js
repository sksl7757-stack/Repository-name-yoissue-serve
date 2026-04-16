// comfyUtils.js — ComfyUI 공통 유틸

const NEGATIVE_PROMPT = `
text, letters, words, numbers, typography, caption, subtitle,
watermark, logo, UI text, interface text, signage, readable text,

nsfw, cleavage, exposed skin, exposed thighs, short skirt, miniskirt,
suggestive pose, sexualized, erotic,

duplicate characters, multiple faces, cloned person, same person twice,

bad anatomy, deformed body, extra limbs, distorted face,

(worst quality:1.4), (low quality:1.4), blurry, pixelated, artifacts
`;

function buildComfyWorkflow(positivePrompt, modelName, loraName) {
  const ckpt = modelName || process.env.SD_MODEL_NAME || 'meinamix_v12Final.safetensors';
  const seed = Math.floor(Math.random() * 2 ** 32);

  // loraName이 없으면 체크포인트 → KSampler 직접 연결 (LoRA 노드 생략)
  if (!loraName) {
    return {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: ckpt },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: positivePrompt, clip: ['1', 1] },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: { text: NEGATIVE_PROMPT, clip: ['1', 1] },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      '6': {
        class_type: 'KSampler',
        inputs: {
          model:        ['1', 0],
          positive:     ['3', 0],
          negative:     ['4', 0],
          latent_image: ['5', 0],
          seed,
          steps:        30,
          cfg:          9,
          sampler_name: 'euler',
          scheduler:    'normal',
          denoise:      1.0,
        },
      },
      '7': {
        class_type: 'VAEDecode',
        inputs: { samples: ['6', 0], vae: ['1', 2] },
      },
      '8': {
        class_type: 'SaveImage',
        inputs: { images: ['7', 0], filename_prefix: 'yoissue' },
      },
    };
  }

  // loraName이 있으면 LoRA 로더 포함
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip:  ['1', 1],
        lora_name:      loraName,
        strength_model: 0.8,
        strength_clip:  0.5,
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['2', 1] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: NEGATIVE_PROMPT, clip: ['2', 1] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model:        ['2', 0],
        positive:     ['3', 0],
        negative:     ['4', 0],
        latent_image: ['5', 0],
        seed,
        steps:        30,
        cfg:          9,
        sampler_name: 'euler',
        scheduler:    'normal',
        denoise:      1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'yoissue' },
    },
  };
}

module.exports = { buildComfyWorkflow };