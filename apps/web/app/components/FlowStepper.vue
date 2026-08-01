<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    active: number;
    paymentRequired?: boolean;
    steps?: string[];
    variant?: 'steps' | 'compact' | 'minimal';
  }>(),
  {
    paymentRequired: true,
    steps: undefined,
    variant: 'steps',
  },
);

const resolvedSteps = computed(
  () =>
    props.steps ?? [
      '填写报名信息',
      props.paymentRequired ? '确认订单并支付' : '确认报名',
      '获取电子票',
    ],
);
</script>

<template>
  <div class="flow-stepper" :class="[`is-${variant}`]" aria-label="报名进度">
    <div
      v-for="(step, index) in resolvedSteps"
      :key="step"
      class="flow-step"
      :class="{ 'is-active': active === index + 1, 'is-done': active > index + 1 }"
    >
      <span class="flow-step__number">{{
        active > index + 1 ? '✓' : String(index + 1).padStart(2, '0')
      }}</span>
      <span>{{ step }}</span>
    </div>
  </div>
</template>
