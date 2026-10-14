// Ruler paint remains inside the optical scene, but its rapidly changing ticks
// no longer rematch the entire application's historical selector cascade.
const rulerStyles = `
:host { --ruler-ink: var(--magi-ui-ink); }
span { display:inline; } small,b,i { box-sizing:border-box; }
.magi-reader-view-columns {position:absolute;height:28px;border-top:1px solid color-mix(in srgb,var(--magi-ui-ink) 28%,transparent);background:linear-gradient(var(--magi-ui-surface),color-mix(in srgb,var(--magi-ui-surface) 90%,transparent));color:var(--magi-ui-ink);}
.magi-reader-view-columns--top{top:0}.magi-reader-view-columns--bottom{bottom:0;transform:scaleY(-1)}
.magi-reader-view-columns i{position:absolute;top:0;width:1px;height:5px;border-left:1px solid color-mix(in srgb,var(--magi-ui-accent) 65%,transparent);opacity:.55}
.magi-reader-view-columns i[data-major=true]{height:9px;border-color:var(--magi-ui-ink);opacity:.85}
.magi-reader-view-columns i[data-active=true]{height:27px;width:2px;opacity:1;border-color:var(--magi-ui-ink);box-shadow:0 0 5px var(--magi-ui-accent)}
.magi-reader-view-columns b,.magi-reader-view-lines b{position:absolute;font:400 9px/1 var(--magi-ruler-font,ui-monospace,Consolas,monospace);color:var(--magi-ui-ink);text-shadow:var(--magi-ruler-shadow,-.35px 0 rgba(217,130,170,.4),.35px 0 rgba(108,238,220,.45),0 0 3px rgba(180,216,199,.35))}
.magi-reader-view-columns b{top:11px;left:0;transform:translateX(-50%)}
.magi-reader-view-columns--bottom b{transform:translateX(-50%) scaleY(-1)}
.magi-reader-view-columns i[data-active=true] b{font-weight:800;padding:1px 2px;background:var(--magi-ui-surface);text-shadow:var(--magi-ruler-shadow,0 0 5px var(--magi-ui-accent));font-weight:var(--magi-ruler-label-weight,800)}
.magi-reader-view-lines{position:absolute;top:0;bottom:0;width:24px;color:var(--magi-ui-ink)}
.magi-reader-view-lines i{position:absolute;left:0;width:4px;height:1px;border-top:1px solid color-mix(in srgb,var(--magi-ui-accent) 65%,transparent)}
.magi-reader-view-lines i[data-major=true]{width:8px;border-color:var(--magi-ui-ink)}
.magi-reader-view-lines i[data-active=true]{width:11px;border-color:var(--magi-ui-ink)}
.magi-reader-view-lines b{top:-4px;left:10px}
.magi-reader-ruler-language{position:absolute;font:var(--magi-ruler-label-weight,700) 9px/1.1 var(--magi-ruler-font,ui-monospace,Consolas,monospace);color:var(--magi-ui-ink);background:var(--magi-ui-surface);padding:2px;text-shadow:var(--magi-ruler-shadow,none)}
.magi-reader-view-columns>.magi-reader-ruler-language{left:-24px;top:8px}
.magi-reader-view-columns--bottom>.magi-reader-ruler-language{transform:scaleY(-1)}
.magi-reader-view-lines>.magi-reader-ruler-language{top:31px;left:0}
:host([data-ruler-layout=stacked]) .magi-reader-view-lines[data-ruler-language=jp]>.magi-reader-ruler-language{left:12px}
`;
export default rulerStyles;
