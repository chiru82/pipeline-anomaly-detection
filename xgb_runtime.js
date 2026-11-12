(function () {
  const packed = window.PIPELINE_XGB_MODEL;
  if (!packed) throw new Error("Saved XGBoost model data was not found.");

  function decodeBase64(base64, Type, length) {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const array = new Type(length);
    for (let i = 0; i < length; i += 1) {
      if (Type === Uint32Array) array[i] = view.getUint32(i * 4, true);
      else if (Type === Int32Array) array[i] = view.getInt32(i * 4, true);
      else if (Type === Float32Array) array[i] = view.getFloat32(i * 4, true);
      else array[i] = view.getUint8(i);
    }
    return array;
  }

  const offsets = decodeBase64(packed.offsets, Uint32Array, packed.treeCount + 1);
  const treeClass = decodeBase64(packed.treeClass, Uint8Array, packed.treeCount);
  const left = decodeBase64(packed.left, Int32Array, packed.nodeCount);
  const right = decodeBase64(packed.right, Int32Array, packed.nodeCount);
  const feature = decodeBase64(packed.feature, Uint8Array, packed.nodeCount);
  const threshold = decodeBase64(packed.threshold, Float32Array, packed.nodeCount);
  const classIds = Object.keys(packed.classNames).map(Number).sort((a, b) => a - b);

  function predict(input) {
    const features = [
      Number(input.flow_rate_l_min),
      Number(input.inlet_pressure_bar),
      Number(input.outlet_pressure_bar),
      Number(input.pipe_diameter_mm),
      Number(input.pipe_length_m),
      input.fluid_type === "Oil" ? 1 : 0,
      input.fluid_type === "Water" ? 1 : 0,
    ];
    if (features.some((value) => !Number.isFinite(value))) throw new Error("Enter finite numbers for all pipeline inputs.");

    const margins = new Float64Array(packed.classCount);
    for (let treeIndex = 0; treeIndex < packed.treeCount; treeIndex += 1) {
      const base = offsets[treeIndex];
      let node = 0;
      let absoluteNode = base;
      while (left[absoluteNode] !== -1) {
        const goLeft = features[feature[absoluteNode]] < threshold[absoluteNode];
        node = goLeft ? left[absoluteNode] : right[absoluteNode];
        absoluteNode = base + node;
      }
      margins[treeClass[treeIndex]] += threshold[absoluteNode];
    }

    let max = -Infinity;
    for (let classId = 0; classId < packed.classCount; classId += 1) {
      margins[classId] /= packed.temperature;
      if (margins[classId] > max) max = margins[classId];
    }
    let total = 0;
    for (let classId = 0; classId < packed.classCount; classId += 1) {
      margins[classId] = Math.exp(margins[classId] - max);
      total += margins[classId];
    }
    const probabilities = Array.from(margins, (score) => score / total);
    let predictedClass = classIds[0];
    for (const classId of classIds.slice(1)) {
      if (probabilities[classId] > probabilities[predictedClass]) predictedClass = classId;
    }
    return {
      classId: predictedClass,
      classLabel: packed.classNames[String(predictedClass)],
      confidence: probabilities[predictedClass],
      probabilities,
    };
  }

  window.PipelineXGBoost = {
    predict,
    classNames: packed.classNames,
    treeCount: packed.treeCount,
    calibrationTemperature: packed.temperature,
  };
}());
