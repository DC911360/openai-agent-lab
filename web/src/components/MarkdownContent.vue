<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const props = defineProps<{
  content: string;
}>();

const html = computed(() =>
  DOMPurify.sanitize(
    marked.parse(props.content, {
      async: false,
      gfm: true,
      breaks: true,
    }),
  ),
);
</script>

<template>
  <!-- 内容已经过 DOMPurify 消毒 -->
  <div class="markdown" v-html="html"></div>
</template>
