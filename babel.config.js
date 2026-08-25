module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo auto-adds react-native-worklets/plugin (which Reanimated
    // needs) when the package is installed, so it must not be listed again here.
    presets: ['babel-preset-expo'],
  };
};
