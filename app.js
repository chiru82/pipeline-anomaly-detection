(function () {
  const form = document.getElementById("prediction-form");
  const inputIds = ["flow_rate_l_min", "inlet_pressure_bar", "outlet_pressure_bar", "pipe_diameter_mm", "pipe_length_m"];
  const inputLabels = ["Flow rate Q", "Inlet pressure P₁", "Outlet pressure P₂", "Pipe diameter D", "Pipe length L"];
  const inputUnits = ["L/min", "bar", "bar", "mm", "m"];
  const classNames = window.PIPELINE_REPORT.classes;
  const recommendationByClass = {
    0: "Continue routine monitoring and compare future readings with the normal reference pattern.",
    1: "Inspect joints and fittings, then confirm the suspected minor leak with a suitable leak or pressure-hold check.",
    2: "Treat the suspected major leak as urgent: verify the readings and follow site procedures to inspect the affected section.",
    3: "Review valves, filters, and the affected pipe section for a possible partial restriction.",
    4: "Verify the sensor and valve status, then inspect for a possible full obstruction under site procedures.",
  };
  const historyKey = "pipeline-anomaly-local-history-v1";
  let sessionHistory = [];
  let applyingDemo = false;
  let hasPrediction = false;

  function number(id) { return Number(document.getElementById(id).value); }
  function fmt(value, digits = 2) { return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
  function getInput() {
    return {
      flow_rate_l_min: number("flow_rate_l_min"),
      inlet_pressure_bar: number("inlet_pressure_bar"),
      outlet_pressure_bar: number("outlet_pressure_bar"),
      pipe_diameter_mm: number("pipe_diameter_mm"),
      pipe_length_m: number("pipe_length_m"),
      fluid_type: document.getElementById("fluid_type").value,
    };
  }
  function conditionFor(classId) {
    if (classId === 0) return "Normal";
    if (classId === 1 || classId === 2) return "Leakage";
    return "Blockage";
  }
  function headlineFor(classId) {
    const condition = conditionFor(classId);
    if (condition === "Normal") return "Normal Flow";
    if (condition === "Leakage") return "Possible Leakage";
    return "Possible Blockage";
  }
  function flowStatusFor(classId) {
    if (classId === 0) return "Normal flow pattern";
    if (classId === 1) return "Possible minor loss";
    if (classId === 2) return "Possible major loss";
    if (classId === 3) return "Possible restriction";
    return "Possible full obstruction";
  }
  function syncHeroAndCharts() {
    const input = getInput();
    document.getElementById("hero-inlet").textContent = `${fmt(input.inlet_pressure_bar)} bar`;
    document.getElementById("hero-flow").textContent = `${fmt(input.flow_rate_l_min)} L/min`;
    document.getElementById("hero-outlet").textContent = `${fmt(input.outlet_pressure_bar)} bar`;
    document.getElementById("trend-drop").textContent = `ΔP ${fmt(input.inlet_pressure_bar - input.outlet_pressure_bar, 3)} bar`;
    renderNormalRange(input);
    drawPressureTrend(input);
  }
  function nearestNormal(input) {
    const profiles = window.PIPELINE_REPORT.normalProfiles;
    let best = null;
    let bestScore = Infinity;
    for (const row of profiles) {
      if (row.fluid_type !== input.fluid_type) continue;
      const diameterScale = 125;
      const lengthScale = 195;
      const score = ((row.pipe_diameter_mm - input.pipe_diameter_mm) / diameterScale) ** 2 + ((row.pipe_length_m - input.pipe_length_m) / lengthScale) ** 2;
      if (score < bestScore) { best = row; bestScore = score; }
    }
    return best;
  }
  function svgPath(points) { return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "); }
  function drawPressureTrend(input) {
    if (![input.inlet_pressure_bar, input.outlet_pressure_bar].every(Number.isFinite)) return;
    const distanceMarks = [0, .25, .5, .75, 1];
    distanceMarks.forEach((fraction, index) => {
      const text = document.getElementById(`trend-distance-${index}`);
      if (text) text.textContent = `${fmt(input.pipe_length_m * fraction, input.pipe_length_m < 10 ? 2 : 1)} m`;
    });
    const reference = nearestNormal(input);
    const pressureValues = [input.inlet_pressure_bar, input.outlet_pressure_bar];
    if (reference) pressureValues.push(reference.inlet_pressure_bar, reference.outlet_pressure_bar);
    const lowValue = Math.min(...pressureValues);
    const highValue = Math.max(...pressureValues);
    const padding = Math.max((highValue - lowValue) * 0.24, 0.08);
    const min = Math.max(0, lowValue - padding);
    const max = highValue + padding;
    const xValues = [65, 232, 400, 567, 735];
    const yFor = (pressure) => 196 - ((pressure - min) / Math.max(max - min, 0.001)) * 172;
    const makePoints = (p1, p2) => xValues.map((x, index) => ({ x, y: yFor(p1 + (p2 - p1) * index / (xValues.length - 1)) }));
    const currentPoints = makePoints(input.inlet_pressure_bar, input.outlet_pressure_bar);
    const currentPath = svgPath(currentPoints);
    document.getElementById("current-line").setAttribute("d", currentPath);
    document.getElementById("current-points").innerHTML = currentPoints.map(({ x, y }) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="4.4"/>`).join("");
    document.getElementById("current-inlet-label").setAttribute("y", Math.max(17, currentPoints[0].y - 9));
    document.getElementById("current-outlet-label").setAttribute("y", Math.max(17, currentPoints[4].y - 9));
    document.getElementById("current-inlet-label").textContent = fmt(input.inlet_pressure_bar, 2);
    document.getElementById("current-outlet-label").textContent = fmt(input.outlet_pressure_bar, 2);

    if (reference) {
      const refPoints = makePoints(reference.inlet_pressure_bar, reference.outlet_pressure_bar);
      const refPath = svgPath(refPoints);
      document.getElementById("reference-line").setAttribute("d", refPath);
      document.getElementById("reference-area").setAttribute("d", `${refPath} L735 196 L65 196 Z`);
      document.getElementById("reference-points").innerHTML = refPoints.map(({ x, y }) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="3.8"/>`).join("");
      document.getElementById("reference-caption").textContent = `Saved simulated Normal reference: ${input.fluid_type}, D ${fmt(reference.pipe_diameter_mm)} mm, L ${fmt(reference.pipe_length_m)} m. Both trend lines interpolate endpoint pressures.`;
    }
  }
  function renderNormalRange(input) {
    const tbody = document.getElementById("normal-range-body");
    const normalRows = window.PIPELINE_REPORT.normalRanges.filter((row) => row.fluid_type === input.fluid_type);
    const keyMap = {
      flow_rate_l_min: "flow_rate_l_min",
      inlet_pressure_bar: "inlet_pressure_bar",
      outlet_pressure_bar: "outlet_pressure_bar",
      pipe_diameter_mm: "pipe_diameter_mm",
      pipe_length_m: "pipe_length_m",
    };
    const unitMap = Object.fromEntries(inputIds.map((field, index) => [field, inputUnits[index]]));
    tbody.innerHTML = inputIds.map((field, index) => {
      const range = normalRows.find((row) => row.parameter === keyMap[field]);
      const current = input[field];
      const rangeText = range ? `${fmt(range.p05, 2)}–${fmt(range.p95, 2)} ${unitMap[field]}` : "—";
      return `<tr><td>${inputLabels[index]}</td><td class="input-value">${fmt(current, 2)} ${unitMap[field]}</td><td>${rangeText}</td></tr>`;
    }).join("");
  }
  function renderProbabilityBars(probabilities, targetId) {
    const target = document.getElementById(targetId);
    target.innerHTML = Object.keys(classNames).map((rawId) => {
      const classId = Number(rawId);
      const label = classNames[rawId];
      const probability = probabilities[classId] || 0;
      return `<div class="probability-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, probability * 100))}%"></div></div><span class="probability-value">${(probability * 100).toFixed(1)}%</span></div>`;
    }).join("");
  }
  function getOutOfRangeWarnings(input) {
    const limits = window.PIPELINE_REPORT.rangesByFluid[input.fluid_type];
    return inputIds.flatMap((field, index) => {
      const range = limits[field];
      if (input[field] >= range.min && input[field] <= range.max) return [];
      return [`${inputLabels[index]} is outside the ${input.fluid_type} training range (${fmt(range.min, 2)}–${fmt(range.max, 2)} ${inputUnits[index]}).`];
    });
  }
  function displayPrediction(input, prediction, save = true) {
    const condition = conditionFor(prediction.classId);
    const exactClass = classNames[String(prediction.classId)];
    const callout = document.getElementById("prediction-callout");
    callout.classList.remove("normal", "blockage");
    if (condition === "Normal") callout.classList.add("normal");
    else if (condition === "Blockage") callout.classList.add("blockage");
    document.getElementById("prediction-title").textContent = headlineFor(prediction.classId);
    document.getElementById("confidence-value").textContent = `${(prediction.confidence * 100).toFixed(1)}%`;
    document.getElementById("predicted-condition").textContent = condition;
    document.getElementById("predicted-class").textContent = exactClass;
    document.getElementById("flow-status").textContent = flowStatusFor(prediction.classId);
    document.getElementById("pressure-drop-result").textContent = `${fmt(input.inlet_pressure_bar - input.outlet_pressure_bar, 3)} bar`;
    const diameterMeters = input.pipe_diameter_mm / 1000;
    const area = Math.PI * (diameterMeters ** 2) / 4;
    const velocity = (input.flow_rate_l_min / 60000) / area;
    document.getElementById("velocity-result").textContent = `${fmt(velocity, 3)} m/s`;
    renderProbabilityBars(prediction.probabilities, "probability-bars");
    renderProbabilityBars(prediction.probabilities, "class-probability-bars");
    document.getElementById("result-empty").classList.add("hidden");
    document.getElementById("result-body").classList.remove("hidden");
    hasPrediction = true;
    document.getElementById("action-empty").classList.add("hidden");
    document.getElementById("action-content").classList.remove("hidden");
    document.getElementById("recommendation-text").textContent = recommendationByClass[prediction.classId];

    const warnings = getOutOfRangeWarnings(input);
    const warning = document.getElementById("out-of-range-note");
    if (warnings.length) {
      warning.textContent = `Input outside the saved training range: ${warnings.join(" ")} The model will still return a prediction, but it may be less reliable.`;
      warning.classList.remove("hidden");
    } else warning.classList.add("hidden");

    if (save) saveHistory({ input, prediction, condition, exactClass, timestamp: new Date().toISOString() });
  }
  function invalidatePrediction(message = "Inputs changed. Select Analyze to refresh the model result.") {
    if (!hasPrediction) return;
    hasPrediction = false;
    document.getElementById("result-body").classList.add("hidden");
    document.getElementById("result-empty").classList.remove("hidden");
    document.querySelector("#result-empty h3").textContent = "Ready to Analyze";
    document.querySelector("#result-empty p").textContent = message;
    document.getElementById("out-of-range-note").classList.add("hidden");
    document.getElementById("action-content").classList.add("hidden");
    document.getElementById("action-empty").classList.remove("hidden");
    document.getElementById("class-probability-bars").innerHTML = '<div class="empty-bars">Analyze an input to display its five class scores.</div>';
  }
  function readHistory() {
    try {
      const stored = localStorage.getItem(historyKey);
      if (stored) return JSON.parse(stored);
    } catch (error) { /* Some browsers restrict storage for local files. */ }
    return sessionHistory;
  }
  function writeHistory(history) {
    sessionHistory = history;
    try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch (error) { /* Keep the current session usable. */ }
  }
  function saveHistory(item) {
    const history = readHistory();
    history.unshift({ ...item, id: `${Date.now()}-${Math.random().toString(16).slice(2)}` });
    writeHistory(history.slice(0, 100));
    renderHistory();
    document.getElementById("history-status").textContent = "Saved in this browser on this device.";
  }
  function renderHistory() {
    const history = readHistory();
    const tbody = document.getElementById("history-body");
    document.getElementById("history-empty").classList.toggle("visible", history.length === 0);
    tbody.innerHTML = history.map((item) => {
      const input = item.input;
      const date = new Date(item.timestamp).toLocaleString();
      const score = item.prediction.confidence;
      return `<tr><td>${date}</td><td>${input.fluid_type}</td><td>${fmt(input.flow_rate_l_min, 2)}</td><td>${fmt(input.inlet_pressure_bar, 2)}</td><td>${fmt(input.outlet_pressure_bar, 2)}</td><td>${fmt(input.pipe_diameter_mm, 2)}</td><td>${fmt(input.pipe_length_m, 2)}</td><td>${item.condition}</td><td>${item.exactClass}</td><td>${(score * 100).toFixed(1)}%</td><td><button class="history-load" data-history-id="${item.id}">Load</button></td></tr>`;
    }).join("");
  }
  function showPage(pageName) {
    document.querySelectorAll(".page-view").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
    document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.pageTarget === pageName));
    if (pageName === "history") renderHistory();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function populateDemoSelector() {
    const selector = document.getElementById("demo-case-select");
    for (const demo of window.PIPELINE_DEMO_CASES) {
      const option = document.createElement("option");
      option.value = demo.id;
      option.textContent = `${demo.id} · ${demo.fluid_type} · new sample`;
      selector.appendChild(option);
    }
    const initial = window.PIPELINE_DEMO_CASES[0];
    if (initial) {
      selector.value = initial.id;
      applyDemo(initial);
    }
  }
  function applyDemo(demo) {
    invalidatePrediction("Demo inputs loaded. Select Analyze to get the XGBoost result.");
    applyingDemo = true;
    for (const field of inputIds) document.getElementById(field).value = Number(demo[field]).toFixed(6);
    document.getElementById("fluid_type").value = demo.fluid_type;
    syncHeroAndCharts();
    applyingDemo = false;
  }
  function setMetrics() {
    const metrics = window.PIPELINE_REPORT.metrics;
    document.getElementById("metric-accuracy").textContent = `${(metrics.accuracy * 100).toFixed(2)}%`;
    document.getElementById("metric-precision").textContent = `${(metrics.macro_precision * 100).toFixed(2)}%`;
    document.getElementById("metric-recall").textContent = `${(metrics.macro_recall * 100).toFixed(2)}%`;
    document.getElementById("metric-f1").textContent = `${(metrics.macro_f1 * 100).toFixed(2)}%`;
  }

  document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.pageTarget)));
  document.getElementById("demo-case-select").addEventListener("change", (event) => {
    const demo = window.PIPELINE_DEMO_CASES.find((item) => item.id === event.target.value);
    if (demo) applyDemo(demo);
  });
  form.addEventListener("input", () => {
    if (!applyingDemo) document.getElementById("demo-case-select").value = "";
    invalidatePrediction();
    syncHeroAndCharts();
  });
  form.addEventListener("change", () => {
    if (!applyingDemo) document.getElementById("demo-case-select").value = "";
    invalidatePrediction();
    syncHeroAndCharts();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("form-error");
    errorBox.textContent = "";
    const input = getInput();
    if (inputIds.some((field) => !Number.isFinite(input[field]))) { errorBox.textContent = "Enter a valid number in each measurement."; return; }
    if (input.flow_rate_l_min < 0 || input.inlet_pressure_bar <= 0 || input.outlet_pressure_bar <= 0 || input.pipe_diameter_mm <= 0 || input.pipe_length_m <= 0) {
      errorBox.textContent = "Use positive pressures, diameter, and length, and a non-negative flow rate."; return;
    }
    if (input.inlet_pressure_bar <= input.outlet_pressure_bar) { errorBox.textContent = "Inlet pressure must be greater than outlet pressure for this demo."; return; }
    document.getElementById("loading-state").classList.remove("hidden");
    window.setTimeout(() => {
      try {
        const prediction = window.PipelineXGBoost.predict(input);
        displayPrediction(input, prediction);
      } catch (error) {
        errorBox.textContent = `The saved model could not score these inputs: ${error.message}`;
      } finally {
        document.getElementById("loading-state").classList.add("hidden");
      }
    }, 35);
  });
  document.getElementById("clear-history").addEventListener("click", () => {
    if (!window.confirm("Clear all saved analysis history from this browser?")) return;
    writeHistory([]);
    document.getElementById("history-status").textContent = "History cleared.";
    renderHistory();
  });
  document.getElementById("history-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-id]");
    if (!button) return;
    const item = readHistory().find((row) => row.id === button.dataset.historyId);
    if (!item) return;
    for (const field of inputIds) document.getElementById(field).value = item.input[field];
    document.getElementById("fluid_type").value = item.input.fluid_type;
    document.getElementById("demo-case-select").value = "";
    invalidatePrediction("History inputs loaded. Select Analyze to refresh the model result.");
    syncHeroAndCharts();
    showPage("home");
  });

  populateDemoSelector();
  setMetrics();
  syncHeroAndCharts();
  renderHistory();
}());
