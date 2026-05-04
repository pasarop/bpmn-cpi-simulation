
/* global process */

import TokenSimulationModule from '../..';

import BpmnModeler from 'bpmn-js/lib/Modeler';

import AddExporter from '@bpmn-io/add-exporter';

import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule
} from 'bpmn-js-properties-panel';

import SimulationSupportModule from '../../lib/simulation-support';

import fileDrop from 'file-drops';

import fileOpen from 'file-open';

import download from 'downloadjs';
import { svgToPng } from './utils';
import gridModule from 'diagram-js-grid';
import ColorPickerModule from 'bpmn-js-color-picker';
import minimapModule from 'diagram-js-minimap';
import BpmnLintModule from 'bpmn-js-bpmnlint';
import bpmnlintConfig from '../../.bpmnlintrc';
import h337 from 'heatmap.js';

import exampleXML from '../resources/example.bpmn';

const url = new URL(window.location.href);

const persistent = url.searchParams.has('p');
const active = url.searchParams.has('e');
const presentationMode = url.searchParams.has('pm');

let fileName = 'example.bpmn';

const initialDiagram = (() => {
  try {
    return persistent && localStorage['diagram-xml'] || exampleXML;
  } catch (err) {
    return exampleXML;
  }
})();

function showMessage(cls, message) {
  const messageEl = document.querySelector('.drop-message');

  if (!messageEl) {
    console.error(message);
    return;
  }

  messageEl.textContent = message;
  messageEl.className = `drop-message ${cls || ''}`;

  messageEl.style.display = 'block';
}

function hideMessage() {
  const messageEl = document.querySelector('.drop-message');

  if (!messageEl) {
    return;
  }

  messageEl.style.display = 'none';
}

if (persistent) {
  hideMessage();
}

const ExampleModule = {
  __init__: [
    ['eventBus', 'bpmnjs', 'toggleMode', function (eventBus, bpmnjs, toggleMode) {

      if (persistent) {
        eventBus.on('commandStack.changed', function () {
          bpmnjs.saveXML().then(result => {
            localStorage['diagram-xml'] = result.xml;
          });
        });
      }

      if ('history' in window) {
        eventBus.on('tokenSimulation.toggleMode', event => {

          document.body.classList.toggle('token-simulation-active', event.active);

          if (event.active) {
            url.searchParams.set('e', '1');
          } else {
            url.searchParams.delete('e');
          }

          history.replaceState({}, document.title, url.toString());
        });
      }

      eventBus.on('diagram.init', 500, () => {
        toggleMode.toggleMode(active);
      });
    }]
  ]
};

const additionalModules = [
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  TokenSimulationModule,
  AddExporter,
  ColorPickerModule,
  gridModule,
  SimulationSupportModule,
  ExampleModule,
  minimapModule,
  BpmnLintModule
];

const modeler = new BpmnModeler({
  container: '#canvas',
  additionalModules,
  propertiesPanel: {
    parent: '#properties-panel'
  },
  linting: {
    active: true,
    bpmnlint: bpmnlintConfig
  },
  exporter: {
    name: 'bpmn-js-token-simulation',
    version: process.env.TOKEN_SIMULATION_VERSION
  }
});

const simulationLog = () => modeler.get('log');

function logMessage(level, message) {
  const log = simulationLog();

  const consoleMethod = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';

  if (console[consoleMethod]) {
    console[consoleMethod](message);
  }

  if (log && typeof log.log === 'function') {
    try {
      log.log({
        text: message,
        type: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'
      });
    } catch (e) {
      console.warn('Could not output to UI log:', e.message);
    }
  }
}

function logInfo(message) {
  logMessage('info', message);
}


function logError(message) {
  logMessage('error', message);
}

const lintingMessagesEl = document.querySelector('#linting-messages');

function sanitizeDiagram(modeler, { persist = false } = {}) {
  const elementRegistry = modeler.get('elementRegistry');
  const seenNames = new Map();

  function nextName(base) {
    let suffix = 2;
    let candidate = base;

    while (seenNames.has(candidate)) {
      candidate = `${base} (${suffix++})`;
    }

    seenNames.set(candidate, true);
    return candidate;
  }

  elementRegistry.getAll().forEach(element => {
    if (element.labelTarget) {
      return;
    }

    const bo = element.businessObject;

    // only normalize BPMN flow nodes (events, tasks, gateways, subprocesses, etc.)
    if (!bo || !bo.$instanceOf || !bo.$instanceOf('bpmn:FlowNode')) {
      return;
    }


    const rawName = (bo.name || '').trim();

    // Clean existing (N) suffixes to prevent accumulation like (2) (2)
    const baseName = (rawName || `${(element.type || '').replace('bpmn:', '') || 'Element'} ${bo.id}`)
      .replace(/\s\(\d+\)$/, '');

    const uniqueName = nextName(baseName);

    if (bo.name !== uniqueName) {
      console.log(`[Sanitize] Renaming ${bo.id}: "${bo.name}" -> "${uniqueName}"`);
      bo.name = uniqueName;
    }
  });

  if (persist) {

    // keep sanitized XML in local storage so the next load stays valid
    modeler.saveXML({ format: true }).then(({ xml }) => {
      localStorage['diagram-xml'] = xml;
    }).catch(() => {

      // non-fatal if persistence fails
    });
  }
}

modeler.get('eventBus').on('linting.completed', ({ issues }) => {
  let hasIssues = false;
  let rowsHtml = '';
  const lintPanel = document.getElementById('lint-panel');
  if (lintPanel) lintPanel.classList.add('visible');
  
  const elementRegistry = modeler.get('elementRegistry');

  Object.keys(issues).forEach(id => {
    const element = elementRegistry.get(id);
    const bo = element ? element.businessObject : null;
    const displayName = bo && bo.name ? bo.name : id;

    issues[id].forEach(issue => {
      hasIssues = true;
      rowsHtml += `
        <tr>
          <td style="border: 1px solid #ccc; padding: 5px; font-size: 0.9em;">
            ${displayName}
          </td>
          <td style="border: 1px solid #ccc; padding: 5px; font-size: 0.9em;">
            ${issue.message}
          </td>
        </tr>
      `;
    });
  });

  lintingMessagesEl.innerHTML = hasIssues
    ? rowsHtml
    : `<tr><td class="state-panel-empty" colspan="2" style="text-align: center; border: 1px solid #ccc; padding: 5px;">Nessun problema rilevato</td></tr>`;
});

function openDiagram(diagram) {
  return modeler.importXML(diagram)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.warn(warnings);
      }

      sanitizeDiagram(modeler, { persist: persistent });

      if (persistent) {
        localStorage['diagram-xml'] = diagram;
      }

      modeler.get('canvas').zoom('fit-viewport');

      // Force ALL tasks to behave as wait states so tokens stay visible on them
      const registry = modeler.get('elementRegistry');
      const simulator = modeler.get('simulator');
      registry.getAll().forEach(el => {
        if (el.type === 'bpmn:Task' || el.type === 'bpmn:UserTask' || el.type === 'bpmn:ServiceTask') {
          simulator.waitAtElement(el, true);
        }
      });

      // Auto-start simulation at t0
      initializeSimulationToStart();
    })
    .catch(err => {
      console.error(err);
    });
}

if (presentationMode) {
  document.body.classList.add('presentation-mode');
}

function openFile(files) {

  // files = [ { name, contents }, ... ]

  if (!files.length) {
    return;
  }

  hideMessage();

  fileName = files[0].name;

  openDiagram(files[0].contents);
}

document.body.addEventListener('dragover', fileDrop('Open BPMN diagram', openFile), false);

function downloadDiagram() {
  modeler.saveXML({ format: true }).then(({ xml }) => {
    download(xml, fileName, 'application/xml');
  });
}

function exportPNG() {
  modeler.saveSVG().then(({ svg }) => {
    svgToPng(svg).then(png => {
      download(png, fileName.replace(/\.bpmn$/i, '.png'), 'image/png');
    });
  });
}

function exportSVG() {
  modeler.saveSVG().then(({ svg }) => {
    download(svg, fileName.replace(/\.bpmn$/i, '.svg'), 'image/svg+xml');
  });
}

document.body.addEventListener('keydown', function (event) {
  if (event.code === 'KeyS' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    downloadDiagram();
  }

  if (event.code === 'KeyO' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    fileOpen().then(openFile);
  }
});

document.querySelector('#download-button').addEventListener('click', function (event) {
  downloadDiagram();
});

document.querySelector('#export-png').addEventListener('click', function (event) {
  exportPNG();
});

document.querySelector('#export-svg').addEventListener('click', function (event) {
  exportSVG();
});

document.querySelector('#open-button').addEventListener('click', () => {
  fileOpen({
    extensions: ['.bpmn'],
    description: 'BPMN diagrams'
  }).then(openFile);
});

// move simulation UI controls (toggle + animation speed) into a dedicated left gutter stack
function moveSimulationControls() {
  console.log('Moving simulation controls to groups');

  const controlGroup = document.getElementById('control-group');
  const monitorGroup = document.getElementById('monitor-group');
  const ioGroup = document.getElementById('io-group');

  // Move token simulation toggle to control group
  const toggleMode = document.querySelector('.bts-toggle-mode');
  if (toggleMode && controlGroup && toggleMode.parentNode !== controlGroup) {
    controlGroup.appendChild(toggleMode);
  }

  // Move token simulation palette to control group
  const paletteEntries = document.querySelector('.bts-palette');
  if (paletteEntries && controlGroup && paletteEntries.parentNode !== controlGroup) {
    controlGroup.appendChild(paletteEntries);
  }

  // Move animation speed control to I/O group (under theme toggle)
  const speedControl = document.querySelector('.bts-set-animation-speed');
  if (speedControl && ioGroup && speedControl.parentNode !== ioGroup) {
    ioGroup.appendChild(speedControl);
  }

  // Move linting messages to monitor group
  const lintPanel = document.getElementById('lint-panel');
  if (lintPanel && monitorGroup && lintPanel.parentNode !== monitorGroup) {
    monitorGroup.appendChild(lintPanel);
  }

  // Move simulation log to monitor group
  const log = document.querySelector('.bts-log');
  if (log && monitorGroup && log.parentNode !== monitorGroup) {
    monitorGroup.appendChild(log);
  }
}

const controlsObserver = new MutationObserver(() => moveSimulationControls());
controlsObserver.observe(document.body, { childList: true, subtree: true });

const elementTokenHistory = new Map();
let messageLogs = []; // Global state for intercepted messages
let currentDiagramName = ''; // Dynamically mapped when loading a diagram

function renderMessageLogs() {
  const panel = document.getElementById('message-panel');
  if (panel) panel.classList.add('visible');

  const tbody = document.getElementById('message-panel-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (messageLogs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="state-panel-empty" colspan="4" style="text-align: center; border: 1px solid #ccc; padding: 5px;">Nessun messaggio tracciato</td>`;
    tbody.appendChild(tr);
    return;
  }

  messageLogs.forEach(msg => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="border: 1px solid #ccc; padding: 5px; font-size: 0.9em; word-break: break-all;">${msg.source}</td>
      <td style="border: 1px solid #ccc; padding: 5px; font-size: 0.9em; word-break: break-all;">${msg.destination}</td>
      <td style="border: 1px solid #ccc; padding: 5px;">${msg.id}</td>
      <td style="border: 1px solid #ccc; padding: 5px;">${msg.payload}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Helpers for extracting correct semantic scope and processes
function getProcessId(el) {
  if (!el || !el.businessObject) return 'UnknownProcess';
  let bo = el.businessObject;
  while (bo && bo.$type !== 'bpmn:Process') {
     bo = bo.$parent;
  }
  return bo ? bo.id : 'UnknownProcess';
}

function getLatestScopeId(elementId) {
  if (elementTokenHistory.has(elementId)) {
    const history = elementTokenHistory.get(elementId);
    if (history.size > 0) {
      return [...history.keys()].pop();
    }
  }
  return 'unknown';
}

modeler.get('eventBus').on('tokenSimulation.simulator.trace', event => {
  const { action, element, scope: elementScope } = event;
  if (!element || !elementScope) return;
  
  if (action === 'enter' || action === 'signal') {
    const elementId = element.id || element;
    if (!elementTokenHistory.has(elementId)) {
      elementTokenHistory.set(elementId, new Map());
    }
    const tokenScope = elementScope.parent || elementScope;
    elementTokenHistory.get(elementId).set(tokenScope.id, 'active');
  }

  if (action === 'exit') {
    const elementId = element.id || element;
    if (elementTokenHistory.has(elementId)) {
       const tokenScope = elementScope.parent || elementScope;
       elementTokenHistory.get(elementId).set(tokenScope.id, 'completed');
    }

    if (element.type === 'bpmn:MessageFlow') {
      const sourceElement = element.source;
      const targetElement = element.target;

      const sourceProcessName = getProcessId(sourceElement);
      const targetProcessName = getProcessId(targetElement);
      
      const diagramId = currentDiagramName; 
      
      const targetScopeId = getLatestScopeId(targetElement.id);
      const sourceScopeId = getLatestScopeId(sourceElement.id);

      const sourceStr = `${sourceElement.id}@${sourceProcessName}.${diagramId}#${sourceScopeId}`;
      const destStr = `${targetElement.id}@${targetProcessName}.${diagramId}#${targetScopeId}`;
      
      const bo = element.businessObject;
      const baseMessageId = bo.messageRef ? bo.messageRef.id : element.id;
      const messageId = `${baseMessageId}#${sourceScopeId}:#${targetScopeId}`;
      const messageName = bo.messageRef && bo.messageRef.name ? bo.messageRef.name : element.id;
      const payloadStr = `contenuto base messaggio ${messageName}`;

      messageLogs.push({
        source: sourceStr,
        destination: destStr,
        id: messageId,
        payload: payloadStr
      });
      
      renderMessageLogs();
    }
  }
});

// --- state sequence playback (drives tokens from JSON snapshots) ---

const playStatesBtn = document.getElementById('play-state-sequence');
const statePanel = document.getElementById('state-panel');
const statePanelTitle = document.getElementById('state-panel-title');
const statePanelBody = document.getElementById('state-panel-body');
const elementRegistry = () => modeler.get('elementRegistry');

// load all JSON state snapshots from /states in lexicographic order
// webpack injects require.context; lint as a known global.
// eslint-disable-next-line no-undef
const statesContext = require.context('../../states', true, /\.json$/);

let stateSequence = [];
let executionOrderMap = null;

function loadStateSequenceForCurrentDiagram() {
  const baseName = fileName.replace(/\.bpmn$/i, '');
  const allKeys = statesContext.keys();
  console.log('[StateLoader] fileName:', fileName, 'baseName:', baseName);
  currentDiagramName = baseName; // Update global baseName for message mapping
  console.log('[StateLoader] All context keys:', allKeys);
  // Filter keys for this specific diagram's subdirectory
  const diagramKeys = allKeys.filter(k => k.startsWith(`./${baseName}/`));
  console.log('[StateLoader] Matched keys for', baseName, ':', diagramKeys);

  stateSequence = diagramKeys.sort((a, b) => {
    const getNumber = (str) => {
      const match = str.match(/t(\d+)\.json$/);
      return match ? parseInt(match[1], 10) : 0;
    };
    return getNumber(a) - getNumber(b);
  }).map(key => ({
    name: key.replace(`./${baseName}/`, '').replace('.json', ''),
    state: statesContext(key)
  }));
  console.log('[StateLoader] Loaded', stateSequence.length, 'snapshots for', baseName);

  executionOrderMap = null;
}

function getExecutionOrderMap() {
  if (executionOrderMap) {
    return executionOrderMap;
  }

  const executionOrder = [];
  const seenTasks = new Set();
  const registry = elementRegistry();

  stateSequence.forEach(snapshot => {
    Object.keys(snapshot.state).forEach(taskId => {
      const registryId = taskId.split('@')[0];
      if (!registry.get(registryId)) {
        console.warn(`Element '${registryId}' in snapshot '${snapshot.name}' not found in the BPMN model. Skipping.`);
        return;
      }

      if (!seenTasks.has(taskId)) {
        executionOrder.push(taskId);
        seenTasks.add(taskId);
      }
    });
  });

  executionOrderMap = new Map(executionOrder.map((id, index) => [id, index]));
  return executionOrderMap;
}

function showStatePanelMessage(message) {
  if (!statePanel || !statePanelBody) {
    return;
  }

  statePanel.classList.add('visible');

  if (statePanelTitle) {
    statePanelTitle.textContent = 'State sequence';
  }

  statePanelBody.innerHTML = '';

  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 2;
  cell.className = 'state-panel-empty';
  cell.textContent = message;

  row.appendChild(cell);
  statePanelBody.appendChild(row);
}

function normalizeStatusClass(status) {
  return `state-status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function renderStateSnapshot(snapshot) {
  if (!snapshot || !statePanel || !statePanelBody) {
    return;
  }

  statePanel.classList.add('visible');

  if (statePanelTitle) {
    statePanelTitle.textContent = `State: ${snapshot.name} (Step Mode)`;
  }

  console.log(`[${new Date().toLocaleTimeString()}] Loading State JSON: ${snapshot.name}`, snapshot.state);

  statePanelBody.innerHTML = '';

  const orderMap = getExecutionOrderMap();
  const entries = Object.entries(snapshot.state).sort(([a], [b]) => {
    const orderA = orderMap.has(a) ? orderMap.get(a) : Infinity;
    const orderB = orderMap.has(b) ? orderMap.get(b) : Infinity;
    return orderA - orderB;
  });

  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.className = 'state-panel-empty';
    cell.textContent = 'No activities in this snapshot';
    row.appendChild(cell);
    statePanelBody.appendChild(row);
    return;
  }

  entries.forEach(([taskId, status]) => {
    const row = document.createElement('tr');
    const taskCell = document.createElement('td');
    const statusCell = document.createElement('td');

    const [registryId, contextId] = taskId.split('@');
    const element = elementRegistry().get(registryId);
    let displayName = element && element.businessObject && element.businessObject.name
      ? element.businessObject.name
      : registryId;
      
    if (contextId) {
      displayName += `@${contextId}`;
    }

    let finalStatus = status;

    if (elementTokenHistory.has(registryId)) {
      const scopeMap = elementTokenHistory.get(registryId);
      if (scopeMap.size > 0) {
        finalStatus = {};
        for (const [scopeId, scopeState] of scopeMap.entries()) {
          // Se lo snapshot in JSON dice 'waiting', ma nel nostro history noi abbiamo messo
          // implicitamente 'active' etc, forziamo il valore del JSON se il processo indica waiting.
          // In ogni caso è preferibile assecondare il JSON principale per coerenza generale.
          const expectedStatus = getOverallStatus(status);
          finalStatus[scopeId] = expectedStatus === 'waiting' ? 'waiting' : scopeState;
        }
      }
    }

    taskCell.textContent = displayName;
    
    if (typeof finalStatus === 'object' && finalStatus !== null) {
      statusCell.style.whiteSpace = "pre-wrap";
      statusCell.innerHTML = '';
      Object.entries(finalStatus).forEach(([tokenId, tokenStatus]) => {
        const div = document.createElement('div');
        div.textContent = `${tokenId}: "${tokenStatus}"`;
        // Apply class to the div based on token status
        div.classList.add(normalizeStatusClass(tokenStatus));
        statusCell.appendChild(div);
      });
    } else {
      statusCell.textContent = `"${finalStatus}"`;
      statusCell.classList.add(normalizeStatusClass(finalStatus));
    }

    row.appendChild(taskCell);
    row.appendChild(statusCell);

    statePanelBody.appendChild(row);
  });
}

function getOverallStatus(status) {
  if (typeof status === 'string') return status;
  if (typeof status === 'object' && status !== null) {
    const values = Object.values(status);
    if (values.includes('active')) return 'active';
    if (values.every(v => v === 'completed')) return 'completed';
    if (values.includes('waiting')) return 'waiting';
    return 'unknown';
  }
  return status;
}

function diffCompletions(prev, next) {
  return Object.keys(next).filter(id => getOverallStatus(prev[id]) === 'active' && getOverallStatus(next[id]) === 'completed');
}

function diffActivations(prev, next) {
  return Object.keys(next).filter(id => getOverallStatus(prev[id]) !== 'active' && getOverallStatus(next[id]) === 'active');
}

function getSortedTriggers(ids) {
  const registry = elementRegistry();
  return ids.sort((a, b) => {
    const elA = registry.get(a);
    const elB = registry.get(b);
    return (elA ? elA.x : 0) - (elB ? elB.x : 0);
  });
}

async function waitForTokenDrain(simulationSupport, ids) {
  const sortedIds = getSortedTriggers(ids);
  console.log('Triggering in order:', sortedIds);

  for (const id of sortedIds) {
    let triggered = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!triggered && attempts < maxAttempts) {
      try {
        const simulator = modeler.get('simulator');
        const element = elementRegistry().get(id);

        if (!element) {
          throw new Error('Element not found in registry');
        }

        const waitingScope = simulator.findScopes({
          element: element
        }).find(scope => scope.children.length === 0 && !scope.destroyed);

        if (waitingScope) {
          console.log(`Found waiting scope for ${id}, signaling...`);
          simulator.signal({
            scope: waitingScope,
            element: element,
            initiator: element
          });
        } else {
          simulationSupport.triggerElement(id);
        }

        console.log(`Triggered ${id} successfully.`);
        triggered = true;
      } catch (err) {
        console.warn(`Attempt ${attempts + 1} to trigger ${id} failed: ${err.message}.`);
        attempts++;
        if (attempts >= maxAttempts) {
          console.error(`Failed to trigger ${id} after ${maxAttempts} attempts. Moving on.`);
        } else {

          // Fallback minimal safe wait before retry if API is genuinely not ready
          await new Promise(r => requestAnimationFrame(r));
        }
      }
    }
  }

  // Wait deterministically for ALL triggers' cascading simulator events and animations to drain
  await drainSimulationQueues();
}

async function drainSimulationQueues() {

  // The simulator processes all jobs synchronously inside queue(),
  // so by the time triggerElement/signal returns, simulator jobs are already done.
  // The only async work is token animations along sequence flows.
  const animation = modeler.get('animation', false);

  if (!animation || !animation._animations) return;

  return new Promise(resolve => {
    const MAX_WAIT = 10000;
    const start = Date.now();

    function checkDrain() {
      const pendingAnimations = animation._animations.size;

      if (pendingAnimations > 0 && (Date.now() - start) < MAX_WAIT) {
        requestAnimationFrame(checkDrain);
      } else {
        resolve();
      }
    }

    // Give animation engine at least 1 frame to start
    requestAnimationFrame(checkDrain);
  });
}

let currentStateIndex = 0;
let isStepping = false;

// Helper to lock exclusive gateways if their path is determined by the next state
// Helper to lock exclusive gateways if their path is determined by the next state
function configureExclusiveGateways(startIndex) {
  const simulator = modeler.get('simulator');
  const registry = elementRegistry();

  // Get all exclusive gateways
  const gateways = registry.getAll().filter(el => el.type === 'bpmn:ExclusiveGateway');

  gateways.forEach(gateway => {

    // Look ahead to find the transition where this gateway consumes its token
    let targetFlow = null;

    // We start searching from the transition leading TO startIndex
    // But we are interested in when the gateway LEAVES (Active -> Inactive)
    for (let i = startIndex; i < stateSequence.length; i++) {
      const prev = i > 0 ? stateSequence[i - 1].state : {};
      const next = stateSequence[i].state;

      // Check if gateway fires in this transition (prev has it, next doesn't)
      const gatewayKeyPrev = Object.keys(prev).find(k => k === gateway.id || k.startsWith(gateway.id + '@'));
      const gatewayKeyNext = Object.keys(next).find(k => k === gateway.id || k.startsWith(gateway.id + '@'));

      const wasActive = gatewayKeyPrev ? getOverallStatus(prev[gatewayKeyPrev]) === 'active' : false;
      const isActive = gatewayKeyNext ? getOverallStatus(next[gatewayKeyNext]) === 'active' : false;

      if (wasActive && !isActive) {

        // Find which outgoing flow matches the activated element
        const activations = diffActivations(prev, next);

        // Find the child that connects to this gateway
        const activeChildId = activations.find(childId => {
          const registryId = childId.split('@')[0];
          const child = registry.get(registryId);
          return child && child.incoming.some(flow => flow.source === gateway);
        });

        if (activeChildId) {
          const registryId = activeChildId.split('@')[0];
          const child = registry.get(registryId);
          targetFlow = child.incoming.find(flow => flow.source === gateway);
        }

        // We found the transition point, stop searching
        break;
      }
    }

    if (targetFlow) {
      simulator.setConfig(gateway, {
        locked: true,
        activeOutgoing: targetFlow,
        wait: true
      });
    } else {

      // If no future transition found for this gateway, unlock it
      // BUT: Only strictly unlock if we scanned the whole future and found nothing.
      // If the gateway is not even active in the sequence, we unlock it (default behavior).
      simulator.setConfig(gateway, { locked: false, wait: false });
    }
  });
}

function initializeSimulationToStart() {
  logInfo('DEBUG: NEW VERSION LOADED (Manual Mode). If you see this message, the code is up to date.');

  loadStateSequenceForCurrentDiagram();

  if (!stateSequence.length) {
    showStatePanelMessage('No state snapshots found for ' + fileName);
    return;
  }

  const simulationSupport = modeler.get('simulationSupport');

  // Ensure token simulation is active
  simulationSupport.toggleSimulation(true);

  // Reset sequence to t0
  currentStateIndex = 0;

  // FORCE PAUSE ON ALL ELEMENTS
  // This ensures the token stops at Gateways, SubProcesses, etc.
  const elementRegistry = modeler.get('elementRegistry');
  const simulator = modeler.get('simulator');

  elementTokenHistory.clear();
  messageLogs = [];
  renderMessageLogs();

  elementRegistry.getAll().forEach(element => {

    // Force pause on all elements EXCEPT EndEvents (they auto-consume) and Processes
    if (element.type !== 'bpmn:Process' && element.type !== 'bpmn:EndEvent') {
      simulator.setConfig(element, { wait: true });
    }
  });

  // Render t0 only. Do NOT trigger Start Event yet.
  // This ensures we start in a "waiting" state (t0).
  // The first click on "Play" will trigger the Start Event (t0 -> t1).
  console.log('Initializing to t0 (Pre-start)...');
  try {
    renderStateSnapshot(stateSequence[0]);
    configureExclusiveGateways(1);
  } catch (e) {
    console.warn('Could not render t0:', e);
  }
}

async function playStates() {
  console.log('PLAY STATE SEQUENCE CLICKED (Manual Mode)');

  if (isStepping) {
    console.warn('Simulation step already in progress...');
    return;
  }

  isStepping = true;
  playStatesBtn.disabled = true;

  try {
    const simulationSupport = modeler.get('simulationSupport');
    const registry = elementRegistry();

    // Ensure simulation is on
    simulationSupport.toggleSimulation(true);

    if (!stateSequence.length) {
      console.warn('No state snapshots found in /states');
      showStatePanelMessage('No snapshots found in /states');
      return;
    }

    // We are at currentStateIndex. We want to go to currentStateIndex + 1.
    const nextIndex = currentStateIndex + 1;

    if (nextIndex < stateSequence.length) {
      const nextSnapshot = stateSequence[nextIndex];
      console.log(`Advancing from ${currentStateIndex} to ${nextIndex}: ${nextSnapshot.name}`);

      logInfo(`STEP ${currentStateIndex} -> ${nextIndex}: ${nextSnapshot.name} - transition in progress.`);

      if (currentStateIndex === 0) {

        // ... t0 -> t1
        // Find the StartEvent that transitions from waiting -> completed in t0 -> t1
        const prev = stateSequence[0].state;
        const next = nextSnapshot.state;
        const startEventIds = Object.keys(next).filter(id => {
          const registryId = id.split('@')[0];
          const el = registry.get(registryId);
          return el && el.type === 'bpmn:StartEvent' && getOverallStatus(prev[id]) === 'waiting' && getOverallStatus(next[id]) === 'completed';
        });
        console.log('[PlayStates] Detected root start events from JSON:', startEventIds);
        if (startEventIds.length > 0) {
          startEventIds.forEach(id => simulationSupport.triggerElement(id.split('@')[0]));
          await drainSimulationQueues();
        } else {
          console.warn('No matching StartEvent found in state snapshots for t0 -> t1');
        }
      } else {

        // Normal Case: tN -> tN+1
        const prev = stateSequence[currentStateIndex].state;
        const next = nextSnapshot.state;

        // Detect StartEvents that fire in this step (waiting -> completed)
        // This handles processes that start later in the sequence (e.g. Sender starts after Receiver)
        // Exclude Message Start Events — they are triggered automatically via MessageFlow
        const lateStartIds = Object.keys(next).filter(id => {
          const registryId = id.split('@')[0];
          const el = registry.get(registryId);
          if (!el || el.type !== 'bpmn:StartEvent') return false;
          if (getOverallStatus(prev[id]) !== 'waiting' || getOverallStatus(next[id]) !== 'completed') return false;
          // Skip Message Start Events (they have a messageEventDefinition)
          const bo = el.businessObject;
          const hasMessageDef = bo && bo.eventDefinitions && bo.eventDefinitions.some(d => d.$type === 'bpmn:MessageEventDefinition');
          if (hasMessageDef) return false;
          // Skip StartEvents inside SubProcesses — they fire automatically
          // when the SubProcess is entered, not via direct trigger
          const parentBo = bo && bo.$parent;
          if (parentBo && (parentBo.$type === 'bpmn:SubProcess' || parentBo.$type === 'bpmn:Transaction')) return false;
          return true;
        });

        if (lateStartIds.length > 0) {
          console.log('[PlayStates] Detected late-starting processes:', lateStartIds);
          lateStartIds.forEach(id => simulationSupport.triggerElement(id.split('@')[0]));
          await drainSimulationQueues();
        }

        const completions = diffCompletions(prev, next);

        // Detect SubProcesses becoming active (entering) OR Catch Events becoming active (pulling from Gateway)
        const activations = diffActivations(prev, next).filter(id => {
          const registryId = id.split('@')[0];
          const el = registry.get(registryId);
          return el && (el.type === 'bpmn:SubProcess' || el.type === 'bpmn:Transaction' || el.type === 'bpmn:IntermediateCatchEvent');
        });

        const allActions = [...activations, ...completions].filter(id => {

          const registryId = id.split('@')[0];
          const el = registry.get(registryId);

          // Do NOT try to trigger EndEvents, they don't support it.
          if (!el || el.type === 'bpmn:EndEvent' || el.type === 'bpmn:EventBasedGateway') return false;

          // Skip IntermediateCatchEvents with signal/message definitions —
          // they are unblocked automatically by the corresponding throw event
          if (el.type === 'bpmn:IntermediateCatchEvent') {
            const bo = el.businessObject;
            const hasAutoTrigger = bo && bo.eventDefinitions && bo.eventDefinitions.some(d =>
              d.$type === 'bpmn:SignalEventDefinition' || d.$type === 'bpmn:MessageEventDefinition'
            );
            if (hasAutoTrigger) return false;
          }

          return true;
        });

        if (allActions.length) {
          const triggerableIds = allActions.map(id => id.split('@')[0]);

          await waitForTokenDrain(simulationSupport, triggerableIds);
        }
      }

      // Update UI to show we are now at nextSnapshot
      renderStateSnapshot(nextSnapshot);
      currentStateIndex = nextIndex;

      configureExclusiveGateways(nextIndex + 1);
    } else {
      console.log('State sequence completed');
      showStatePanelMessage('State sequence completed.');
    }
  } catch (err) {
    console.error('State playback failed', err);
    logError('Error while playing the step: ' + err.message);
  } finally {

    // ALWAYS re-enable the button
    isStepping = false;
    playStatesBtn.disabled = false;

    // Auto-refresh heatmap if visible
    if (heatmapVisible && heatmapInstance) {
      updateHeatmapData();
    }
  }
}

playStatesBtn.onclick = () => {
  playStates();
};

modeler.get('eventBus').on('tokenSimulation.resetSimulation', () => {

  // Restart from t0 (no tokens)
  initializeSimulationToStart();
});


// Properties panel is now always visible in the left sidebar

const remoteDiagram = url.searchParams.get('diagram');

if (remoteDiagram) {
  fetch(remoteDiagram).then(
    r => {
      if (r.ok) {
        return r.text();
      }

      throw new Error(`Status ${r.status}`);
    }
  ).then(
    text => openDiagram(text)
  ).catch(
    err => {
      showMessage('error', `Failed to open remote diagram: ${err.message}`);

      openDiagram(initialDiagram);
    }
  );
} else {
  openDiagram(initialDiagram);
}

// ─── Heatmap Overlay ───────────────────────────────────────────────────────
let heatmapInstance = null;
let heatmapContainer = null;
let heatmapVisible = false;

// Track token frequency per element (how many times a token has entered each element)
const elementTokenFrequency = new Map();

// Tap into existing simulation trace to count entries
modeler.get('eventBus').on('tokenSimulation.simulator.trace', event => {
  const { action, element } = event;
  if (!element) return;

  if (action === 'enter') {
    const elementId = element.id || element;
    elementTokenFrequency.set(elementId, (elementTokenFrequency.get(elementId) || 0) + 1);
  }
});

// Reset heatmap frequency data when simulation resets
modeler.get('eventBus').on('tokenSimulation.resetSimulation', () => {
  elementTokenFrequency.clear();
  if (heatmapInstance) {
    heatmapInstance.setData({ max: 1, data: [] });
  }
});

function createHeatmapOverlay() {
  const canvasEl = document.querySelector('#canvas');
  if (!canvasEl) return;

  // Pause MutationObserver to prevent scroll during DOM manipulation
  controlsObserver.disconnect();

  // Remove old overlay if it exists
  if (heatmapContainer && heatmapContainer.parentNode) {
    heatmapContainer.parentNode.removeChild(heatmapContainer);
  }

  heatmapContainer = document.createElement('div');
  heatmapContainer.id = 'heatmap-overlay';
  heatmapContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
  `;
  canvasEl.appendChild(heatmapContainer);

  heatmapInstance = h337.create({
    container: heatmapContainer,
    radius: 70,
    maxOpacity: 0.6,
    minOpacity: 0.08,
    blur: 0.8,
    gradient: {
      0.1: '#2196F3',
      0.3: '#4CAF50',
      0.5: '#FFEB3B',
      0.7: '#FF9800',
      1.0: '#F44336'
    }
  });

  // Re-enable observer after DOM is settled
  requestAnimationFrame(() => {
    controlsObserver.observe(document.body, { childList: true, subtree: true });
  });
}

function getHeatmapFrequencyData() {
  // Use real-time frequency tracking if available
  if (elementTokenFrequency.size > 0) {
    return elementTokenFrequency;
  }

  // Fallback: derive frequency from elementTokenHistory (populated by state sequence playback)
  const fallback = new Map();
  elementTokenHistory.forEach((scopeMap, elementId) => {
    fallback.set(elementId, scopeMap.size || 1);
  });
  return fallback;
}

function updateHeatmapData() {
  if (!heatmapInstance || !heatmapContainer) return;

  const canvas = modeler.get('canvas');
  const registry = modeler.get('elementRegistry');
  const containerRect = heatmapContainer.getBoundingClientRect();
  const data = [];
  let max = 1;

  const freqData = getHeatmapFrequencyData();

  if (freqData.size === 0) {
    console.log('[Heatmap] No frequency data yet — run the simulation first.');
    heatmapInstance.setData({ max: 1, data: [] });
    return;
  }

  // Find max frequency for normalization
  freqData.forEach(count => {
    if (count > max) max = count;
  });

  freqData.forEach((count, elementId) => {
    const element = registry.get(elementId);
    if (!element) return;

    // Use getBoundingClientRect on SVG graphics for pixel-perfect coordinates
    const gfx = canvas.getGraphics(element);
    if (!gfx) return;

    const elemRect = gfx.getBoundingClientRect();
    const screenX = elemRect.left + elemRect.width / 2 - containerRect.left;
    const screenY = elemRect.top + elemRect.height / 2 - containerRect.top;

    // Only add points within the visible container
    if (screenX >= 0 && screenY >= 0 &&
        screenX <= containerRect.width &&
        screenY <= containerRect.height) {
      data.push({
        x: Math.round(screenX),
        y: Math.round(screenY),
        value: count
      });
    }
  });

  console.log('[Heatmap] Rendering', data.length, 'data points, max:', max);
  heatmapInstance.setData({ max, data });
}

function toggleHeatmap(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  heatmapVisible = !heatmapVisible;

  const btn = document.getElementById('toggle-heatmap');

  if (heatmapVisible) {
    createHeatmapOverlay();
    updateHeatmapData();
    btn.textContent = 'Hide Heatmap';
    btn.style.background = '#e3f2fd';
    btn.style.borderColor = '#2196F3';

    console.log('[Heatmap] Enabled — tracked elements:', elementTokenFrequency.size,
      ', history elements:', elementTokenHistory.size);
  } else {
    // Pause observer to prevent scroll on removal too
    controlsObserver.disconnect();

    if (heatmapContainer && heatmapContainer.parentNode) {
      heatmapContainer.parentNode.removeChild(heatmapContainer);
    }
    heatmapInstance = null;
    heatmapContainer = null;
    btn.textContent = 'Toggle Heatmap';
    btn.style.background = '';
    btn.style.borderColor = '';

    requestAnimationFrame(() => {
      controlsObserver.observe(document.body, { childList: true, subtree: true });
    });

    console.log('[Heatmap] Disabled');
  }
}

// Refresh heatmap when canvas is panned/zoomed
modeler.get('eventBus').on('canvas.viewbox.changed', () => {
  if (heatmapVisible && heatmapInstance) {
    updateHeatmapData();
  }
});

document.getElementById('toggle-heatmap').addEventListener('click', toggleHeatmap);

// expose for theming
window.bpmnjs = modeler;

