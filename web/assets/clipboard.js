export async function writeClipboardText(text) {
  let value;
  try {
    value = String(text ?? "");
  } catch {
    return false;
  }

  try {
    const clipboard = navigator.clipboard;
    const writeText = clipboard?.writeText;
    if (typeof writeText === "function") {
      await writeText.call(clipboard, value);
      return true;
    }
  } catch {
    // Fall back when Clipboard API access or writing is unavailable.
  }

  try {
    return copyWithExecCommand(value);
  } catch {
    return false;
  }
}

function copyWithExecCommand(text) {
  let textarea = null;
  const selectionState = captureSelectionState();

  try {
    const host = document.body || document.documentElement;
    if (!host) return false;

    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    textarea.setAttribute("tabindex", "-1");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    host.appendChild(textarea);

    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const execCommand = document.execCommand;
    return typeof execCommand === "function"
      ? Boolean(execCommand.call(document, "copy"))
      : false;
  } catch {
    return false;
  } finally {
    removeTemporaryElement(textarea);
    restoreSelectionState(selectionState);
  }
}

function captureSelectionState() {
  const state = {
    activeElement: null,
    inputSelection: null,
    documentSelectionCaptured: false,
    ranges: [],
  };

  try {
    state.activeElement = document.activeElement;
  } catch {
    // Ignore inaccessible focus state.
  }

  try {
    const element = state.activeElement;
    if (
      element &&
      typeof element.selectionStart === "number" &&
      typeof element.selectionEnd === "number"
    ) {
      state.inputSelection = {
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection,
      };
    }
  } catch {
    // Ignore elements that do not expose a readable text selection.
  }

  try {
    const selection = document.getSelection?.();
    if (selection) {
      state.documentSelectionCaptured = true;
      for (let index = 0; index < selection.rangeCount; index += 1) {
        state.ranges.push(selection.getRangeAt(index).cloneRange());
      }
    }
  } catch {
    state.documentSelectionCaptured = false;
    state.ranges = [];
  }

  return state;
}

function removeTemporaryElement(element) {
  if (!element) return;
  try {
    element.remove();
  } catch {
    try {
      element.parentNode?.removeChild(element);
    } catch {
      // Cleanup is best effort.
    }
  }
}

function restoreSelectionState(state) {
  const element = state.activeElement;

  try {
    if (
      element?.isConnected !== false &&
      typeof element?.focus === "function"
    ) {
      try {
        element.focus({ preventScroll: true });
      } catch {
        element.focus();
      }
    }
  } catch {
    // Focus restoration is best effort.
  }

  try {
    if (
      state.inputSelection &&
      typeof element?.setSelectionRange === "function"
    ) {
      element.setSelectionRange(
        state.inputSelection.start,
        state.inputSelection.end,
        state.inputSelection.direction
      );
    }
  } catch {
    // Input selection restoration is best effort.
  }

  if (state.documentSelectionCaptured) {
    try {
      const selection = document.getSelection?.();
      if (selection) {
        selection.removeAllRanges();
        state.ranges.forEach((range) => selection.addRange(range));
      }
    } catch {
      // Document selection restoration is best effort.
    }
  }
}
