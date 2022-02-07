import map from 'lodash-es/map';
import find from 'lodash-es/find';
import compact from 'lodash-es/compact';
import intersection from 'lodash-es/intersection'
// just add here the lodash functions you want to support
const chainableFunctions = {
  map,
  find,
  compact,
  intersection
};

export const chain = (input) => {
  let value = input;
  const wrapper = {
    ...mapValues(
      chainableFunctions,
      (f) => (...args) => {
        // lodash always puts input as the first argument
        value = f(value, ...args);
        return wrapper;
      },
    ),
    value: () => value,
  };
  return wrapper;
};