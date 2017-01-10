const { parse } = require('graphql');
const { zip, flatten, compact } = require('lodash');
const print = require('./printGraphql');

module.exports = ({ types: t }) => {
  const isGqlString = path =>
    t.isIdentifier(path.get('tag').node, { name: 'gql' });

  const interpolateError = () => {
    throw new Error(`only constant string literal references allowed in gql interpolation`);
  };

  const getStringLiteral = (e, scope) => {
    if (!t.isIdentifier(e.node)) interpolateError();

    const binding = scope.getBinding(e.node.name);
    if (!binding.constant) interpolateError();

    const value = binding.path.get('init');
    if (!t.isStringLiteral(value.node)) interpolateError();
    return value.node.value;
  };

  return {
    visitor: {
      TaggedTemplateExpression(template) {
        if (isGqlString(template)) {
          const literal = template.get('quasi');
          const expressions = literal.get('expressions');
          const quasis = literal.get('quasis');

          const query = compact(flatten(zip(
            quasis.map(q => q.node.value.raw),
            expressions.map(e => getStringLiteral(e, template.scope))
          ))).join('');

          const minified = print(parse(`{${query}}`)).trim().replace(/^{/, '').replace(/}$/, '');
          template.replaceWith(t.stringLiteral(minified));
        }
      },
    },
  };
};
