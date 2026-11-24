// Supabase layer for Our Daily Bread: real login (Supabase Auth), roles (profiles table),
// per-key data sync with realtime updates. If supabase-config.js is blank the app runs
// exactly as before on localStorage only.
(function () {
  'use strict';
  var URL_ = window.SUPABASE_URL, KEY = window.SUPABASE_ANON_KEY;
  if (!URL_ || !KEY || !window.supabase) { console.info('[sync] Supabase not configured; local-only mode.'); return; }
  var sb = window.supabase.createClient(URL_, KEY);
  var hasSaved = false;
  try { for (var i = 0; i < localStorage.length; i++) { if (/^sb-.*-auth-token$/.test(localStorage.key(i))) hasSaved = true; } } catch (e) {}
  if (hasSaved) {
    var st = document.createElement('style'); st.id = 'chk-style';
    st.textContent = 'html.chk #wel{display:none!important}';
    document.head.appendChild(st); document.documentElement.classList.add('chk');
    setTimeout(function () { document.documentElement.classList.remove('chk'); }, 8000);
  }
  function doneChecking() { document.documentElement.classList.remove('chk'); }

  // Personal data: one private row per signed-in user. Shared data: one row for everybody.
  // Move a key between the two lists if you want different behaviour.
  var PERSONAL = { att: [], stu: {}, notes: [], pr: [], seenN: [], sampleD: [], mcRead: {}, users: [] };
  var SHARED = { community: [], announcements: [], ev: [], give: '', med: [], sc: [], kid: {}, kat: {},
                 plan: null, planImg: null, planSeed: null, upSongs: null, sgLinks: null };

  var loadErr = '', me = null, ready = false, snap = {}, psnap = '', timer = null, chan = null, hb = null;
  var origSave = window.save, origSignout = window.signout;
  var clone = function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); };
  var allKeys = function () { return Object.keys(PERSONAL).concat(Object.keys(SHARED)); };

  function resetLocal() {
    allKeys().forEach(function (k) {
      var d = k in PERSONAL ? PERSONAL[k] : SHARED[k];
      if (d === null) delete DB[k]; else DB[k] = clone(d);
    });
    DB.accounts = [];
    try { origSave(); } catch (e) {}
  }

  function toAccount(p) {
    return { id: p.id, name: p.name || '', email: p.email || '', role: p.role, requested: p.requested || undefined,
             bio: p.bio || '', avatarData: p.avatar || '', created: p.created_at, lastSeen: Number(p.last_seen) || 0 };
  }

  async function loadProfiles() {
    var r = await sb.from('profiles').select('*');
    if (r.error) { console.error('[sync] profiles', r.error.message); loadErr = r.error.message; return; }
    loadErr = '';
    DB.accounts = r.data.map(toAccount);
    var mine = me && DB.accounts.find(function (a) { return a.id === me.id; });
    if (mine) { activeAccount = mine; who = mine.name; role = mine.role; }
  }

  function applyRow(row) {
    var k = row.key;
    if ((row.owner_id === null && k in SHARED) || (me && row.owner_id === me.id && k in PERSONAL)) {
      DB[k] = clone(row.value);
      snap[k] = JSON.stringify(DB[k]);
    }
  }

  async function loadData() {
    var r = await sb.from('app_data').select('key,value,owner_id');
    if (r.error) { console.error('[sync] data', r.error.message); }
    else r.data.forEach(applyRow);
    snap = {};
    allKeys().forEach(function (k) { if (DB[k] !== undefined) snap[k] = JSON.stringify(DB[k]); });
    var a = activeAccount;
    psnap = a ? JSON.stringify([a.name, a.bio || '', a.avatarData || '']) : '';
    try { origSave(); } catch (e) {}
  }

  function flush() {
    if (!ready || !me) return;
    var now = new Date().toISOString(), rows = [];
    allKeys().forEach(function (k) {
      if (DB[k] === undefined) return;
      var j = JSON.stringify(DB[k]);
      if (j === snap[k]) return;
      snap[k] = j;
      var personal = k in PERSONAL;
      rows.push({ id: personal ? k + ':' + me.id : k, key: k, owner_id: personal ? me.id : null,
                  value: JSON.parse(j), updated_by: me.id, updated_at: now });
    });
    if (rows.length) sb.from('app_data').upsert(rows).then(function (r) {
      if (r.error) { console.error('[sync] save failed', r.error.message); rows.forEach(function (x) { delete snap[x.key]; }); }
    });
    var a = activeAccount;
    if (a) {
      var p = JSON.stringify([a.name, a.bio || '', a.avatarData || '']);
      if (p !== psnap) {
        psnap = p;
        sb.from('profiles').update({ name: a.name, bio: a.bio || '', avatar: a.avatarData || '' }).eq('id', me.id)
          .then(function (r) { if (r.error) { console.error('[sync] profile', r.error.message); psnap = ''; } });
      }
    }
  }
  function push() { if (!ready) return; clearTimeout(timer); timer = setTimeout(flush, 700); }
  window.save = function () { origSave.apply(this, arguments); push(); };

  function softRender() {
    var el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // don't wipe what someone is typing
    try { render(); } catch (e) {}
  }

  function subscribe() {
    chan = sb.channel('cm-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_data' }, function (p) {
        var row = p.new;
        if (!row || !row.key || row.updated_by === me.id) return;
        applyRow(row); softRender();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, function (p) {
        var n = p.new, o = p.old, changed = false;
        if (p.eventType === 'DELETE') {
          var before = DB.accounts.length;
          DB.accounts = DB.accounts.filter(function (a) { return a.id !== (o && o.id); });
          changed = DB.accounts.length !== before;
        } else if (n && n.id) {
          var ex = DB.accounts.find(function (a) { return a.id === n.id; }), m = toAccount(n);
          if (!ex) { DB.accounts.push(m); changed = true; }
          else {
            changed = ex.role !== m.role || ex.requested !== m.requested || ex.name !== m.name;
            if (n.id === me.id) { m.name = ex.name; m.bio = ex.bio; m.avatarData = ex.avatarData; } // keep my unsaved edits
            Object.assign(ex, m);
            if (n.id === me.id) role = ex.role;
          }
        }
        if (changed) softRender();
      }).subscribe();
    hb = setInterval(function () {
      if (me) sb.from('profiles').update({ last_seen: Date.now() }).eq('id', me.id).then(function () {});
    }, 30000);
    sb.from('profiles').update({ last_seen: Date.now() }).eq('id', me.id).then(function () {});
  }

  async function enterApp(session) {
    me = session.user;
    resetLocal();
    await loadProfiles();
    var mine = DB.accounts.find(function (a) { return a.id === me.id; });
    if (!mine) { await sb.auth.signOut(); me = null; resetLocal(); return false; }
    await loadData();
    ready = true;
    var w = document.getElementById('wel'); if (w) w.classList.add('hide');
    render(); refreshHeaderProfile(); subscribe();
    return true;
  }

  window.signin = async function () {
    var email = ($('#lu').value || '').trim().toLowerCase(), pw = $('#lp').value || '';
    if (email === 'host' && window.HOST_LOGIN_EMAIL) email = window.HOST_LOGIN_EMAIL.toLowerCase();
    loginClear();
    if (!email || !pw) { loginErr(!email ? 'lu' : 'lp', !email ? 'Enter your email or Host username.' : 'Enter your password.'); return; }
    var r = await sb.auth.signInWithPassword({ email: email, password: pw });
    if (r.error) { loginErr('lp', /invalid login/i.test(r.error.message) ? 'Incorrect email or password.' : r.error.message); return; }
    if (!(await enterApp(r.data.session))) loginErr('lu', loadErr ? 'Database error: ' + loadErr + ' (run supabase/schema.sql)' : 'No profile found for this account. Run supabase/schema.sql, then recreate the account.');
  };

  window.signup = async function () {
    var n = ($('#sn').value || '').trim(), email = ($('#se').value || '').trim().toLowerCase(),
        pw = $('#sp').value || '', pw2 = $('#sp2').value || '', r = $('#sr').value;
    if (!n || !email || !pw) { alert('Please complete your name, email and password.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Enter a valid email address.'); return; }
    if (pw.length < 8) { alert('Use a password with at least 8 characters.'); return; }
    if (pw !== pw2) { alert('The passwords do not match.'); return; }
    var res = await sb.auth.signUp({ email: email, password: pw,
      options: { data: { name: n, requested: r === 'Evangelist' ? 'Evangelist' : '' } } });
    if (res.error) { alert(res.error.message); return; }
    if (res.data.session) { await enterApp(res.data.session); }
    else { alert('Account created. Check your email to confirm it, then sign in.'); welStep('sg'); }
  };

  window.signout = function () {
    ready = false; clearInterval(hb); clearTimeout(timer);
    if (chan) { sb.removeChannel(chan); chan = null; }
    me = null; sb.auth.signOut(); resetLocal();
    origSignout.apply(this, arguments);
  };

  window.changeLocalPassword = function () {
    var p = $('#newpw').value;
    if (p.length < 8) return alert('Use at least 8 characters.');
    sb.auth.updateUser({ password: p }).then(function (r) {
      if (r.error) return alert(r.error.message);
      alert('Password updated.'); profileSection('security');
    });
  };

  window.hostRole = async function (id, r) {
    var t = DB.accounts.find(function (y) { return y.id === id; });
    if (r === 'Host') return alert('There is only one Host account.');
    if (t && t.role === 'Host' && r !== 'Host') {
      if (me && id === me.id) return alert('You cannot remove your own Host access.');
      if (!confirm('Remove Host access from ' + t.name + '? They become a Youth member.')) return;
    }
    var x = await sb.from('profiles').update({ role: r, requested: null }).eq('id', id);
    if (x.error) return alert(x.error.message);
    var a = DB.accounts.find(function (y) { return y.id === id; });
    if (a) { a.role = r; a.requested = undefined; }
    communityView();
  };
  window.hostRemove = async function (id) {
    var a = DB.accounts.find(function (y) { return y.id === id; });
    if (!a || !confirm('Remove ' + a.name + '? They will lose access and their login is deleted.')) return;
    var x = await sb.rpc('admin_delete_user', { uid: id });
    if (x.error) return alert(x.error.message);
    DB.accounts = DB.accounts.filter(function (y) { return y.id !== id; });
    communityView();
  };

  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) enterApp(r.data.session).then(doneChecking, doneChecking); else doneChecking();
  }, doneChecking);
})();
