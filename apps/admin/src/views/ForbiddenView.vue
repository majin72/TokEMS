<script setup lang="ts">
import { session } from '../lib/api';
</script>

<template>
  <main class="admin-standalone-state">
    <RouterLink class="admin-state-brand" :to="{ name: session.landingRouteName() }">
      <span class="brand-mark" aria-hidden="true">G</span>
      <span>TokEMS 运营台</span>
    </RouterLink>
    <section class="admin-state">
      <span class="admin-state__code">403</span>
      <p class="eyebrow">ACCESS CONTROL</p>
      <h1>当前账号无权访问此页面</h1>
      <p>你的账号仍可继续使用已授权的管理模块。如需更多权限，请联系组织管理员。</p>
      <div class="admin-state__actions">
        <RouterLink class="button" :to="{ name: session.landingRouteName() }">
          返回可用模块
        </RouterLink>
      </div>
    </section>
  </main>
</template>
