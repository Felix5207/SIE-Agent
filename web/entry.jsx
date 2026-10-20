// Keep existing projects and their advanced research workflows addressable.
const params = new URLSearchParams(location.search);
if (params.has('legacy') || params.has('record')) {
  import('./main.jsx');
} else {
  import('./ExtractApp.jsx');
}
