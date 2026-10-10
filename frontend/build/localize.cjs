// Localize authored JSX at build time. API payloads, routes, input values and
// user content remain untouched. No DOM rewriting or runtime machine translation.
module.exports = function localize({ types: t }) {
  const attributes = new Set(['title', 'placeholder', 'aria-label', 'aria-description', 'alt', 'label', 'description', 'empty', 'hint', 'help', 'lead']);
  const displayFields = /^(label|empty|hint|help|placeholder|description)$/;
  const displayNames = /^(label|error|err|message|statusText|titleText|emptyText|captionLabel|hint|help|placeholder)$/;
  function message(state, text) {
    if (!/[A-Za-z]/.test(text)) return;
    state.opts.onMessage?.(text.trim().replace(/\s+/g, ' '));
  }
  function translate(node, state) {
    state.used = true;
    return t.callExpression(t.identifier('__uiT'), [node]);
  }
  function rendered(node, state) {
    if (t.isStringLiteral(node)) { message(state, node.value); return /[A-Za-z]/.test(node.value) ? translate(node, state) : node; }
    if (t.isTemplateLiteral(node)) {
      const key = node.quasis.map((q, i) => (q.value.cooked || '') + (i < node.expressions.length ? `{{v${i}}}` : '')).join('');
      if (!/[A-Za-z]/.test(key.replace(/\{\{v\d+\}\}/g, ''))) return t.templateLiteral(node.quasis, node.expressions.map(e => rendered(e, state)));
      message(state, key); state.used = true;
      return t.callExpression(t.identifier('__uiT'), [t.stringLiteral(key), t.objectExpression(node.expressions.map((e, i) => t.objectProperty(t.identifier(`v${i}`), rendered(e, state))))]);
    }
    if (t.isConditionalExpression(node)) return t.conditionalExpression(node.test, rendered(node.consequent, state), rendered(node.alternate, state));
    if (t.isLogicalExpression(node)) return t.logicalExpression(node.operator, node.left, rendered(node.right, state));
    if (t.isMemberExpression(node) && !node.computed && displayFields.test(node.property.name)) return translate(node, state);
    if (t.isIdentifier(node) && displayNames.test(node.name)) return translate(node, state);
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && /(?:label|relative|ago|dayName|monthName)/i.test(node.callee.name)) return translate(node, state);
    return node;
  }
  function authored(node, scope, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (t.isLiteral(node)) return true;
    if (t.isArrayExpression(node)) return node.elements.every(e => authored(e, scope, new Set(seen)));
    if (t.isObjectExpression(node)) return node.properties.every(p => t.isObjectProperty(p) && authored(p.value, scope, new Set(seen)));
    if (t.isMemberExpression(node)) return authored(node.object, scope, seen);
    if (t.isIdentifier(node)) {
      const binding = scope.getBinding(node.name);
      if (!binding) return false;
      if (binding.path.isVariableDeclarator()) return authored(binding.path.node.init, binding.path.scope, seen);
      if (binding.kind === 'param') {
        const fn = binding.path.findParent(p => p.isFunction());
        const call = fn?.parentPath;
        if (call?.isCallExpression() && t.isMemberExpression(call.node.callee) && ['map', 'filter', 'find'].includes(call.node.callee.property.name)) return authored(call.node.callee.object, call.scope, seen);
      }
    }
    return false;
  }
  return { visitor: {
    Program: {
      enter(path, state) { state.used = false; state.components = []; },
      exit(path, state) {
        if (!state.used) return;
        for (const component of state.components) {
          const body = component.node.body;
          if (!t.isBlockStatement(body)) component.node.body = t.blockStatement([t.returnStatement(body)]);
          component.node.body.body.unshift(t.expressionStatement(t.callExpression(t.identifier('__useUiLocale'), [])));
        }
        path.unshiftContainer('body', t.importDeclaration([
          t.importSpecifier(t.identifier('__uiT'), t.identifier('translate')),
          t.importSpecifier(t.identifier('__useUiLocale'), t.identifier('useLocale')),
          t.importSpecifier(t.identifier('__uiLocale'), t.identifier('intlLocale')),
        ], t.stringLiteral('/src/i18n/index.jsx')));
      },
    },
    Function(path, state) {
      let name = path.node.id?.name;
      if (!name && t.isVariableDeclarator(path.parent)) name = path.parent.id.name;
      if (!name && t.isCallExpression(path.parent) && t.isVariableDeclarator(path.parentPath.parent)) name = path.parentPath.parent.id.name;
      if (!/^[A-Z]/.test(name || '') && !t.isExportDefaultDeclaration(path.parent)) return;
      let jsx = false; path.traverse({ JSXElement() { jsx = true; }, JSXFragment() { jsx = true; } });
      if (jsx) state.components.push(path);
    },
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (opening.name.name !== 'option' || opening.attributes.some(a => a.name?.name === 'value')) return;
      const children = path.node.children.filter(c => !t.isJSXText(c) || c.value.trim());
      if (children.length === 1) {
        const child = children[0];
        if (t.isJSXText(child)) opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('value'), t.stringLiteral(child.value.trim())));
        else if (t.isJSXExpressionContainer(child)) opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('value'), t.jsxExpressionContainer(t.cloneNode(child.expression, true))));
      }
    },
    JSXText(path, state) {
      if (path.findParent(p => p.isJSXElement() && p.node.openingElement.attributes.some(a => a.name?.name === 'translate' && a.value?.value === 'no'))) return;
      const tag = path.parent.openingElement?.name?.name;
      if (['style', 'script', 'code', 'pre'].includes(tag)) return;
      // Match React/Babel's JSX whitespace rules, preserving spaces around inline elements.
      const lines = path.node.value.split(/\r\n|\n|\r/);
      const text = lines.map((line, i) => {
        let s = line.replace(/\t/g, ' ');
        if (i !== 0) s = s.replace(/^ +/, '');
        if (i !== lines.length - 1) s = s.replace(/ +$/, '');
        return s;
      }).filter(Boolean).join(' ');
      if (!/[A-Za-z]/.test(text)) return;
      message(state, text);
      path.replaceWith(t.jsxExpressionContainer(translate(t.stringLiteral(text), state)));
      path.skip();
    },
    JSXAttribute(path, state) {
      if (!attributes.has(path.node.name.name) || !path.node.value) return;
      const v = path.node.value;
      if (t.isStringLiteral(v)) path.node.value = t.jsxExpressionContainer(rendered(v, state));
      else if (t.isJSXExpressionContainer(v)) v.expression = rendered(v.expression, state);
      path.skip();
    },
    JSXExpressionContainer(path, state) {
      if (t.isJSXAttribute(path.parent)) return;
      const original = path.node.expression;
      path.node.expression = rendered(original, state);
      if (path.node.expression === original && (t.isIdentifier(original) || t.isMemberExpression(original)) && authored(original, path.scope)) path.node.expression = translate(original, state);
    },
    CallExpression(path, state) {
      const c = path.node.callee;
      if ((t.isIdentifier(c) || t.isMemberExpression(c) && t.isIdentifier(c.object, { name: 'window' })) && ['alert', 'confirm'].includes(c.name || c.property?.name) && path.node.arguments[0]) path.node.arguments[0] = rendered(path.node.arguments[0], state);
      if (t.isMemberExpression(c) && !c.computed && /^toLocale(DateString|TimeString|String)$/.test(c.property.name)) {
        const first = path.node.arguments[0];
        if (!first || t.isStringLiteral(first) && /^en(?:-|$)/.test(first.value) || t.isIdentifier(first, {name:'undefined'}) || t.isArrayExpression(first) && !first.elements.length) {
          state.used = true;
          path.node.arguments[0] = t.callExpression(t.identifier('__uiLocale'), []);
        }
      }
    },
  } };
};
