import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/reference.css';
import './styles/admin-reference.css';
import './styles/admin.css';
import './styles/admin-polish.css';
import './styles/template-invoice.css';

createApp(App).use(router).mount('#app');
