const { parse, visit } = require('graphql');
const { zip, flatten, compact } = require('lodash');

// Adapted from https://github.com/graphql/graphql-js/blob/master/src/language/printer.js
const printDocASTReducer = {
  Name: node => node.value,
  Variable: node => '$' + node.name,

  // Document

  Document: node => join(node.definitions, ' ') + '\n',

  OperationDefinition(node) {
    const op = node.operation;
    const name = node.name;
    const varDefs = wrap('(', join(node.variableDefinitions, ','), ')');
    const directives = join(node.directives, ' ');
    const selectionSet = node.selectionSet;
    // Anonymous queries with no directives or variable definitions can use
    // the query short form.
    return !name && !directives && !varDefs && op === 'query' ?
      selectionSet :
      join([ op, join([ name, varDefs ]), directives, selectionSet ], ' ');
  },

  VariableDefinition: ({ variable, type, defaultValue }) =>
    variable + ':' + type + wrap('=', defaultValue),

  SelectionSet: ({ selections }) => wrap('{', join(selections, ','), '}'),

  Field: ({ alias, name, arguments: args, directives, selectionSet }) =>
    join([
      wrap('', alias, ':') + name + wrap('(', join(args, ','), ')'),
      join(directives, ' '),
      selectionSet
    ], ''),

  Argument: ({ name, value }) => name + ':' + value,

  // Fragments

  FragmentSpread: ({ name, directives }) =>
    '...' + name + wrap(' ', join(directives, ' ')),

  InlineFragment: ({ typeCondition, directives, selectionSet }) =>
    join([
      '...',
      wrap('on ', typeCondition),
      join(directives, ' '),
      selectionSet
    ], ''),

  FragmentDefinition: ({ name, typeCondition, directives, selectionSet }) =>
    `fragment ${name} on ${typeCondition} ` +
    wrap('', join(directives, ' '), ' ') +
    selectionSet,

  // Value

  IntValue: ({ value }) => value,
  FloatValue: ({ value }) => value,
  StringValue: ({ value }) => JSON.stringify(value),
  BooleanValue: ({ value }) => JSON.stringify(value),
  NullValue: () => 'null',
  EnumValue: ({ value }) => value,
  ListValue: ({ values }) => '[' + join(values, ', ') + ']',
  ObjectValue: ({ fields }) => '{' + join(fields, ', ') + '}',
  ObjectField: ({ name, value }) => name + ': ' + value,

  // Directive

  Directive: ({ name, arguments: args }) =>
    '@' + name + wrap('(', join(args, ', '), ')'),

  // Type

  NamedType: ({ name }) => name,
  ListType: ({ type }) => '[' + type + ']',
  NonNullType: ({ type }) => type + '!',

  // Type System Definitions

  SchemaDefinition: ({ directives, operationTypes }) =>
    join([
      'schema',
      join(directives, ' '),
      block(operationTypes),
    ], ' '),

  OperationTypeDefinition: ({ operation, type }) =>
    operation + ': ' + type,

  ScalarTypeDefinition: ({ name, directives }) =>
    join([ 'scalar', name, join(directives, ' ') ], ' '),

  ObjectTypeDefinition: ({ name, interfaces, directives, fields }) =>
    join([
      'type',
      name,
      wrap('implements ', join(interfaces, ', ')),
      join(directives, ' '),
      block(fields)
    ], ' '),

  FieldDefinition: ({ name, arguments: args, type, directives }) =>
    name +
    wrap('(', join(args, ', '), ')') +
    ': ' + type +
    wrap(' ', join(directives, ' ')),

  InputValueDefinition: ({ name, type, defaultValue, directives }) =>
    join([
      name + ': ' + type,
      wrap('= ', defaultValue),
      join(directives, ' ')
    ], ' '),

  InterfaceTypeDefinition: ({ name, directives, fields }) =>
    join([
      'interface',
      name,
      join(directives, ' '),
      block(fields)
    ], ' '),

  UnionTypeDefinition: ({ name, directives, types }) =>
    join([
      'union',
      name,
      join(directives, ' '),
      '= ' + join(types, ' | ')
    ], ' '),

  EnumTypeDefinition: ({ name, directives, values }) =>
    join([
      'enum',
      name,
      join(directives, ' '),
      block(values)
    ], ' '),

  EnumValueDefinition: ({ name, directives }) =>
    join([ name, join(directives, ' ') ], ' '),

  InputObjectTypeDefinition: ({ name, directives, fields }) =>
    join([
      'input',
      name,
      join(directives, ' '),
      block(fields)
    ], ' '),

  TypeExtensionDefinition: ({ definition }) => `extend ${definition}`,

  DirectiveDefinition: ({ name, arguments: args, locations }) =>
    'directive @' + name + wrap('(', join(args, ', '), ')') +
    ' on ' + join(locations, ' | '),
};

/**
 * Given maybeArray, print an empty string if it is null or empty, otherwise
 * print all items together separated by separator if provided
 */
const join = (maybeArray, separator) =>
  maybeArray
    ? maybeArray.filter(x => x).join(separator || '')
    : '';

/**
 * Given array, print each item on its own line, wrapped in a "{ }" block.
 */
const block = array =>
  (array && array.length !== 0
    ? `{${join(array, ' ')}}`
    : '{}');

/**
 * If maybeString is not null or empty, then wrap with start and end, otherwise
 * print an empty string.
 */
const wrap = (start, maybeString, end) =>
  maybeString
    ? start + maybeString + (end || '')
    : '';

const print = ast => visit(ast, { leave: printDocASTReducer });

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
        console.log('TTE', template);
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
