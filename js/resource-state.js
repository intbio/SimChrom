/* Resource lifecycle shared by the existing tables and SVG interactions. */
var resources = {};
var pendingSelection = null;
var tabHashes = {
    'home-tab': '', 'fig1-tab': '#localization', 'fig2-tab': '#classification',
    'SHvsPFAM-tab': '#domain_composition', 'PFAMvsPFAM-tab': '#domain_co-occurrence',
    'Help-tab': '#help', 'Download-tab': '#download', 'NovelStructuralDomains-tab': '#novel_structural_domains'
};
function resourceStatus(id, anchor, label) {
    if (resources[id]) return resources[id];
    const status = document.createElement('div');
    status.className = 'resource-status small my-2';
    status.setAttribute('role', 'status');
    anchor.before(status);
    return resources[id] = {ready: false, status, label};
}
function showResource(id, state, retry) {
    const resource = resources[id];
    resource.ready = state === 'ready';
    resource.status.hidden = resource.ready;
    resource.status.replaceChildren();
    if (state !== 'ready') {
        resource.status.append(document.createTextNode(state === 'loading'
            ? 'Loading ' + resource.label + '… Related controls will be available when ready.'
            : 'Could not load ' + resource.label + '. Please try again. '));
        if (state === 'error') {
            const button = document.createElement('button');
            button.className = 'btn btn-outline-secondary btn-sm';
            button.textContent = 'Retry';
            button.onclick = retry;
            resource.status.append(button);
        }
    }
    syncResourceControls();
}
function syncResourceControls() {
    const ready = !!resources.main?.ready;
    document.querySelectorAll('#select_controls input, #select_controls button, #sim_chrome_sl_switch, #table_container input, #table_container select, #table_container button').forEach(el => { if (!el.closest('.resource-status')) el.disabled = !ready; });
    ['landing', 'fig1', 'fig2'].forEach(id => {
        const object = document.getElementById(id);
        object.style.pointerEvents = ready && resources[id]?.ready ? '' : 'none';
        object.setAttribute('aria-disabled', String(!ready || !resources[id]?.ready));
    });
    if (!resources.fig2?.ready) document.getElementById('sim_chrome_sl_switch').disabled = true;
    const active = get_current_active_fig();
    if (active && !resources[active]?.ready) {
        document.querySelectorAll('#select_controls input, #select_controls button').forEach(el => el.disabled = true);
    }
    if (resources.domains) document.querySelectorAll('#novel_domains_table_wrapper button, #novel_domains_table_wrapper input, #novel_domains_table_wrapper select').forEach(el => { if (!el.closest('.resource-status')) el.disabled = !resources.domains.ready; });
}
function resourceLoader(id, url) {
    resourceStatus(id, document.getElementById(id === 'main' ? 'select_controls' : 'novel_domains_table'), id === 'main' ? 'protein table' : 'domain table');
    return function (_, callback) {
        const load = async function () {
            showResource(id, 'loading');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            try {
                const response = await fetch(url, {signal: controller.signal});
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const json = await response.json();
                if (!Array.isArray(json.data) || !json.data.length || json.data.some(row => !row || typeof row !== 'object' || !('Gene' in row))) throw new Error('Invalid table data');
                callback(json);
                resourceReady(id);
            } catch (error) {
                console.error('Loading ' + url + ':', error);
                showResource(id, 'error', load);
            } finally { clearTimeout(timeout); }
        };
        load();
    };
}
function resourceReady(id) {
    if (resources[id].ready) return;
    showResource(id, 'ready');
    if (id === 'main' && window.table) {
        applyBaseFilter();
        table.draw();
        applyPendingSelection();
    }
}
function initializeSvg(id) {
    const object = document.getElementById(id);
    resourceStatus(id, object, id === 'landing' ? 'overview figure' : id === 'fig1' ? 'localization figure' : 'SimChrom figure');
    let boundDocument = null;
    let timer;
    const retry = () => {
        clearTimeout(timer);
        // Chromium can retain a failed object's fallback state after changing data.
        const replacement = object.cloneNode(false);
        replacement.data = object.getAttribute('data').split('?')[0] + '?retry=' + Date.now();
        object.replaceWith(replacement);
        initializeSvg(id);
    };
    const fail = () => { clearTimeout(timer); showResource(id, 'error', retry); };
    const armTimeout = () => { clearTimeout(timer); timer = setTimeout(() => { if (object.closest('.tab-pane')?.classList.contains('active')) fail(); else armTimeout(); }, 60000); };
    const bind = () => {
        const doc = object.contentDocument;
        if (!doc || doc.documentElement?.localName !== 'svg') return false;
        const boxes = doc.querySelectorAll('rect.svgcheckbox');
        if (!boxes.length) return false;
        if (boundDocument !== doc) {
            boxes.forEach(box => {
                box.setAttribute('pointer-events', 'all');
                box.style.cursor = 'pointer';
                box.setAttribute('tabindex', '0');
                box.setAttribute('role', id === 'landing' ? 'button' : 'checkbox');
                if (id !== 'landing') box.setAttribute('aria-checked', String(box.style.fill === 'green'));
                box.setAttribute('aria-label', box.id.replaceAll('_', ' '));
                box.onclick = id === 'landing' ? go_to_list : select_check;
                box.onkeydown = event => {
                    if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        box.onclick(event);
                    }
                };
                if (id !== 'fig1') {
                    box.style.strokeWidth = '0';
                    box.onmouseover = () => {
                        if (resources.main.ready && box.style.fill !== 'green') {
                            box.style.fill = 'blue'; box.style.fillOpacity = '0.5';
                        }
                    };
                    box.onmouseout = () => {
                        if (box.style.fill !== 'green') { box.style.fill = 'white'; box.style.fillOpacity = '0'; }
                    };
                }
            });
            boundDocument = doc;
        }
        clearTimeout(timer);
        showResource(id, 'ready');
        if (id === 'fig2') draw_fig2_numbers();
        applyPendingSelection();
        return true;
    };
    object.addEventListener('load', () => { if (!bind()) fail(); });
    object.addEventListener('error', fail);
    showResource(id, 'loading');
    if (!bind()) armTimeout();
}
function applyBaseFilter() {
    if (!resources.main?.ready) return;
    // Each search setter runs filtering immediately, even for an empty column.
    table.columns().every(function () {
        if (this.search() !== '') this.search('');
    });
    const active = document.querySelector('#myTab .nav-link.active')?.id;
    if (['fig2-tab', 'SHvsPFAM-tab', 'PFAMvsPFAM-tab'].includes(active)) {
        table.column(16).search(d => !!String(d || '').trim());
    }
    if (['SHvsPFAM-tab', 'PFAMvsPFAM-tab'].includes(active)) {
        table.column(17).search(d => !!String(d || '').trim());
    }
}
function applyPendingSelection() {
    if (!pendingSelection || !resources.main?.ready || !resources[pendingSelection.fig]?.ready) return;
    const {fig, children} = pendingSelection;
    pendingSelection = null;
    reset_all(false);
    // These are explicit overview targets, not automatic hierarchy expansion.
    String(children || '').split(',').forEach(id => {
        const node = document.getElementById(fig).contentDocument.getElementById(id.trim());
        if (!node) return;
        node.style.fill = 'green';
        if (fig !== 'fig1') node.style.fillOpacity = '0.5';
    });
    filter_table_by_selected_checkboxes(fig);
}
async function ensurePlot(id) {
    const plot = document.getElementById(id);
    if (plot.dataset.initialized) return;
    plot.dataset.initialized = 'loading';
    resourceStatus(id, plot, 'domain plot');
    showResource(id, 'loading');
    try {
        await window.plotFactories[id]();
        plot.on('plotly_click', data => {
            if (!resources.main.ready || !data.points?.length) return;
            const point = data.points[0];
            const x = plot.layout.xaxis.ticktext[point.x];
            const y = plot.layout.yaxis.ticktext[point.y];
            if (id === 'SHvsPfam_plot') {
                const label = plot.querySelector('.updatemenu-item-text')?.textContent || '';
                filter_table_by_plot(y, x, label.includes('SL'));
            } else filter_table_by_plot2(x, y);
        });
        plot.dataset.initialized = 'ready';
        showResource(id, 'ready');
    } catch (error) {
        delete plot.dataset.initialized;
        showResource(id, 'error', () => ensurePlot(id));
        console.error(error);
    }
}
function updateTab(button) {
    const id = button.id;
    const analytical = ['fig1-tab', 'fig2-tab', 'SHvsPFAM-tab', 'PFAMvsPFAM-tab'].includes(id);
    document.getElementById('table_container').style.display = analytical ? 'block' : 'none';
    document.getElementById('select_controls').style.display = ['fig1-tab', 'fig2-tab'].includes(id) ? 'block' : 'none';
    if (pendingSelection && id !== pendingSelection.fig + '-tab') pendingSelection = null;
    reset_all();
    if (id === 'SHvsPFAM-tab') ensurePlot('SHvsPfam_plot');
    if (id === 'PFAMvsPFAM-tab') ensurePlot('PfamvsPfam_plot');
    if (resources.main.ready) table.columns.adjust();
    if (resources.domains.ready) domain_table.columns.adjust();
    syncResourceControls();
    applyPendingSelection();
}
function initializeInterface() {
    ['landing', 'fig1', 'fig2'].forEach(initializeSvg);
    [['unirot_filter_vis_switch','uniprot'], ['HPA_filter_vis_switch','hpa'], ['OpenCell_filter_vis_switch','opencell']].forEach(([id, col]) => {
        document.getElementById(id).addEventListener('change', event => {
            if (resources.main.ready) toggle_filter_columns(event.target.checked, col);
        });
    });
    document.getElementById('sim_chrome_sl_switch').addEventListener('change', () => {
        if (!resources.main.ready || !resources.fig2.ready) return;
        draw_fig2_numbers(); reset_all();
    });
    document.getElementById('intersect_switch').addEventListener('change', () => filter_table_by_selected_checkboxes(get_current_active_fig()));
    document.querySelectorAll('#myTab button').forEach(button => button.addEventListener('shown.bs.tab', () => {
        updateTab(button);
        const hash = tabHashes[button.id] || '';
        if (location.hash !== hash) history.pushState(null, '', location.pathname + location.search + hash);
    }));
    const restoreTab = () => {
        const id = Object.keys(tabHashes).find(id => tabHashes[id] === location.hash) || 'home-tab';
        const button = document.getElementById(id);
        bootstrap.Tab.getOrCreateInstance(button).show();
    };
    window.addEventListener('popstate', restoreTab);
    window.addEventListener('hashchange', restoreTab);
    restoreTab();
    updateTab(document.querySelector('#myTab .nav-link.active'));
}
