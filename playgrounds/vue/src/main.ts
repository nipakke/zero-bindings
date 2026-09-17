import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import { zero } from "./zero/app-bindings.ts";

const app = createApp(App);

// Installing builds this app's session from the bindings' client source,
// provides it to the composables, and disposes it — with every resource it
// owns — on unmount. Swapping the bindings' client source (`activeClient`)
// rematerializes each active query in place.
app.use(zero);

app.mount("#app");
