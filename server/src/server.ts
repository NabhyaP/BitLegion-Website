import { createApp } from './app.ts';
import { env } from './config/env.ts';

createApp().listen(env.PORT, () => {
  console.log(`bitlegion server on :${env.PORT} (${env.NODE_ENV})`);
});
