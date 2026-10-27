/* trainsyou Brain showcase bootstrap (≤ 1 KB, classic script, inline it).
   [data-showcase][data-sc-module] → data-sc="pre" → after load + idle →
   when within 200 px → import(module).mount(el). Static final state shows
   if nothing started by 6 s. */
(function(){var d=document,w=window,E=[].slice.call(d.querySelectorAll("[data-showcase][data-sc-module]"));if(!E.length)return;
E.forEach(function(e){e.setAttribute("data-sc","pre")});
setTimeout(function(){E.forEach(function(e){if(e.getAttribute("data-sc")=="pre")e.removeAttribute("data-sc")})},6000);
function go(e){import(new URL(e.getAttribute("data-sc-module"),d.baseURI).href).then(function(m){return(m.mount||m.default)(e)}).catch(function(x){e.removeAttribute("data-sc");w.console&&console.warn("showcase",x)})}
function start(){E.forEach(function(e){if(!w.IntersectionObserver)return go(e);var io=new IntersectionObserver(function(n){if(n.some(function(x){return x.isIntersecting})){io.disconnect();go(e)}},{rootMargin:"200px"});io.observe(e)})}
function idle(){w.requestIdleCallback?requestIdleCallback(start,{timeout:1500}):setTimeout(start,300)}
d.readyState=="complete"?idle():w.addEventListener("load",idle)})();
