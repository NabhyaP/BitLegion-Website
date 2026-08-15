import { createApp } from './app.ts';
import { env } from './config/env.ts';

createApp().listen(env.PORT, '0.0.0.0', () => {
  console.log(`bitlegion server on :${env.PORT} (${env.NODE_ENV})`);
  console.log(`Local:   http://localhost:${env.PORT}`);
  console.log(`Network: http://10.10.22.145:${env.PORT}`);
});
