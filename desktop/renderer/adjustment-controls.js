import { numberField as n, colorField as c, boolField as b } from './settings-dialog.js';
export function adjustmentFields(kind) {
  switch (kind) {
    case 'Hue/Saturation': return [b('colorize', 'Colorize'), b('invertRange', 'Invert selected range'), { key: 'editRange', label: 'Selected range', options: ['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'], default: 'Master' }, ...['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'].flatMap((name, i) => [{ section: name, open: i === 0 }, n(`editRanges.${name}.hue`, 'Hue', -360, 360), n(`editRanges.${name}.saturation`, 'Saturation', -100, 100), n(`editRanges.${name}.lightness`, 'Lightness', -100, 100), ...(i ? ['falloffStart', 'rangeStart', 'rangeEnd', 'falloffEnd'].map((key) => n(`editBands.${name}.${key}`, key.replace(/([a-z])([A-Z])/g, '$1 $2'), 0, 360)) : [])])];
    case 'Levels': return ['RGB', 'Red', 'Green', 'Blue'].flatMap((name, i) => [{ section: name, open: i === 0 }, n(`levels.ranges.${i}.black`, 'Input black', 0, 254), n(`levels.ranges.${i}.gamma`, 'Gamma', .1, 9.99, 1, .01), n(`levels.ranges.${i}.white`, 'Input white', 1, 255, 255), n(`levels.ranges.${i}.outputBlack`, 'Output black', 0, 255), n(`levels.ranges.${i}.outputWhite`, 'Output white', 0, 255, 255)]);
    case 'Curves': return ['RGB', 'Red', 'Green', 'Blue'].map((name, i) => ({ key: `curves.channels.${i}`, label: name, type: 'curve', default: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }));
    case 'Exposure': return [n('exposureSettings.exposure', 'Exposure', -20, 20, 0, .1), n('exposureSettings.offset', 'Offset', -.5, .5, 0, .01), n('exposureSettings.gamma', 'Gamma', .01, 9.99, 1, .01)];
    case 'Gradient Map': return [c('gradientMapSettings.shadows', 'Shadows'), c('gradientMapSettings.highlights', 'Highlights', { red: 1, green: 1, blue: 1 }), b('gradientMapSettings.reversed', 'Reverse')];
    case 'Grain': return [n('grainSettings.amount', 'Amount', 0, 100, 25), n('grainSettings.size', 'Size', .5, 20, 1.5, .1), n('grainSettings.roughness', 'Roughness', 0, 100, 50), n('grainSettings.seed', 'Seed', 0, 2147483647)];
    case 'Black & White': return ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((key, i) => n(`blackWhiteSettings.${key}`, key[0].toUpperCase() + key.slice(1), -200, 300, [40, 60, 40, 60, 20, 80][i])).concat([b('blackWhiteSettings.tint', 'Tint'), n('blackWhiteSettings.tintHue', 'Tint hue', 0, 360, 40), n('blackWhiteSettings.tintSaturation', 'Tint saturation', 0, 100, 20)]);
    case 'Color Balance': return ['shadow', 'mid', 'highlight'].flatMap((tone) => [{ section: tone, open: true }, ...['CyanRed', 'MagentaGreen', 'YellowBlue'].map((key) => n(`colorBalanceSettings.${tone}${key}`, key.replace(/([a-z])([A-Z])/g, '$1 / $2'), -100, 100))]).concat(b('colorBalanceSettings.preserveLuminosity', 'Preserve luminosity', true));
    case 'Gaussian Blur': return [n('blurRadius', 'Radius', .1, 250, 10, .1)];
    case 'Motion Blur': return [n('motionAngle', 'Angle', -90, 90), n('motionDistance', 'Distance', 1, 2000, 10)];
    case 'Add Noise': return [n('noiseAmount', 'Amount', .1, 400, 10, .1), b('noiseGaussian', 'Gaussian'), b('noiseMonochromatic', 'Monochromatic'), n('noiseSeed', 'Seed', 0, 2147483647)];
    default: return [];
  }
}
export function effectFields(kind) {
  const fields = [b('enabled', 'Enabled', true), c('color', 'Color'), n('opacity', 'Opacity', 0, 1, 1, .01)];
  if (kind === 'stroke') fields.push(n('size', 'Size', 0, 500, 4), b('inside', 'Inside'));
  if (kind === 'shadow' || kind === 'innerShadow') fields.push(n('angle', 'Angle', -360, 360, 90), n('distance', 'Distance', 0, 5000, 10), n('blur', 'Blur', 0, 500, 10));
  if (kind === 'outerGlow' || kind === 'innerGlow') fields.push(n('size', 'Size', 0, 500, 20));
  return fields;
}
export function cameraRawFields(image) {
  const fields = [{ section: 'Light', open: true }, n('exposure', 'Exposure', -5, 5, 0, .1), ...['contrast', 'highlights', 'shadows', 'whites', 'blacks'].map((key) => n(key, key, -100, 100)),
    { section: 'Color' }, ...['temperature', 'tint', 'vibrance', 'saturation'].map((key) => n(key, key, -100, 100)),
    { section: 'Effects' }, ...['texture', 'clarity', 'dehaze'].map((key) => n(key, key, -100, 100)), n('glow', 'Glow', 0, 100), { key: 'glowStyle', label: 'Glow style', options: ['Diffusion', 'Bloom', 'Halation'], default: 'Diffusion' },
    ...['glowRange', 'glowSpread', 'glowWarmth'].map((key) => n(key, key, 0, 100)), n('vignetteAmount', 'Vignette', -100, 100), n('vignetteMidpoint', 'Midpoint', 0, 100, 50), n('vignetteRoundness', 'Roundness', -100, 100), n('vignetteFeather', 'Feather', 0, 100, 50), n('vignetteHighlights', 'Protect highlights', 0, 100),
    n('grainAmount', 'Grain', 0, 100), n('grainSize', 'Grain size', 0, 100, 25), n('grainRoughness', 'Grain roughness', 0, 100, 50), { section: 'Curves' },
    ...['rgb', 'red', 'green', 'blue'].map((key) => ({ key: `curve.${key}`, label: key, type: 'curve', maximum: 1, default: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })),
    ...['shadows', 'darks', 'lights', 'highlights'].map((key) => n(`curve.${key}`, `Curve ${key}`, -100, 100)), n('curve.shadowSplit', 'Shadow divider', 1, 98, 25), n('curve.darkSplit', 'Midtone divider', 2, 99, 50), n('curve.lightSplit', 'Highlight divider', 3, 99, 75), n('curve.refineSaturation', 'Refine saturation', -100, 100),
    { section: 'Color mixer' }, ...['hue', 'saturation', 'luminance'].flatMap((key) => ['Reds', 'Oranges', 'Yellows', 'Greens', 'Aquas', 'Blues', 'Purples', 'Magentas'].map((name, i) => n(`mixer.${key}.${i}`, `${name} ${key}`, -100, 100))),
    { section: 'Point color' }, { key: 'mixer.points', label: 'Sampled colors', type: 'point-colors' },
    { section: 'Color grading' }, ...['shadows', 'midtones', 'highlights', 'global'].flatMap((tone) => [n(`grading.${tone}.hue`, `${tone} hue`, 0, 360), n(`grading.${tone}.saturation`, `${tone} saturation`, 0, 100), n(`grading.${tone}.luminance`, `${tone} luminance`, -100, 100)]), n('grading.blending', 'Blending', 0, 100, 50), n('grading.balance', 'Balance', -100, 100),
    { section: 'Detail' }, n('detail.sharpenAmount', 'Sharpening', 0, 150), n('detail.sharpenRadius', 'Sharpen radius', .5, 3, 1, .1), n('detail.sharpenDetail', 'Sharpen detail', 0, 100, 25), n('detail.sharpenMasking', 'Sharpen masking', 0, 100),
    ...['noiseLuminance', 'noiseLuminanceDetail', 'noiseLuminanceContrast', 'noiseColor', 'noiseColorDetail', 'noiseColorSmoothness'].map((key) => n(`detail.${key}`, key.replace(/([a-z])([A-Z])/g, '$1 $2'), 0, 100, /Detail|Smoothness/.test(key) ? 50 : 0)),
    { section: 'Optics' }, b('optics.removeChromaticAberration', 'Remove chromatic aberration'), b('optics.enableLensProfile', 'Lens profile'), n('optics.profileDistortion', 'Profile distortion', 0, 200, 100), n('optics.profileVignetting', 'Profile vignetting', 0, 200, 100), n('optics.distortion', 'Distortion', -100, 100),
    ...['purple', 'green'].flatMap((color) => [n(`optics.${color}Amount`, `${color} defringe`, 0, 20), n(`optics.${color}HueLow`, `${color} hue low`, 0, 360, color === 'purple' ? 270 : 60), n(`optics.${color}HueHigh`, `${color} hue high`, 0, 360, color === 'purple' ? 310 : 120)]),
    { section: 'Geometry' }, { key: 'geometry.projection', label: 'Projection', options: ['Perspective', 'Rectilinear'], default: 'Perspective' }, { key: 'geometry.upright', label: 'Upright', options: ['Off', 'Guided'], default: 'Off' }, { key: 'geometry.guides', label: 'Draw alignment guides', type: 'guides', image }, n('geometry.vertical', 'Vertical', -100, 100), n('geometry.horizontal', 'Horizontal', -100, 100), n('geometry.rotate', 'Rotate', -45, 45, 0, .1), n('geometry.aspect', 'Aspect', -100, 100), n('geometry.scale', 'Scale', -99, 100), n('geometry.offsetX', 'Horizontal offset', -100, 100), n('geometry.offsetY', 'Vertical offset', -100, 100),
    { section: 'Calibration' }, n('calibration.shadowTint', 'Shadow tint', -100, 100), ...['red', 'green', 'blue'].flatMap((key) => [n(`calibration.${key}Hue`, `${key} primary hue`, -100, 100), n(`calibration.${key}Saturation`, `${key} primary saturation`, -100, 100)]), n('calibration.processVersion', 'Process version', 1, 6, 6)];
  return fields;
}
