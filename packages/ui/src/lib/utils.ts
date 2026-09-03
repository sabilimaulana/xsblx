// `cn` is re-exported rather than imported from `cn` directly so the swap
// stays a one-line change here — shadcn generates `@xsblx/ui/lib/utils` imports
// and every component already points at this path.
export { cn } from "cn";
