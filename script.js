(function () {
  var LS = "controle-da-van-v1";
  var fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var TIPOS_OK = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
  var state = { alunos: [], valorPadrao: "", cidadePadrao: "" };
  var ui = { mes: mesKey(new Date()), filtro: "todos", tela: "lista", alunoId: null, painel: null, pgValor: "", arquivo: null, pgErro: "", enviando: false, remover: false, desfazer: false, erroForm: "" };
  var docRef = null, saving = false, dirty = false, loaded = false;
  var dbArquivos = null;
  var $ = function (id) { return document.getElementById(id); };

  function mesKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function somaMes(key, n) { var p = key.split("-"); return mesKey(new Date(+p[0], +p[1] - 1 + n, 1)); }
  function mesNome(key, curto) {
    var p = key.split("-");
    var s = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("pt-BR", { month: curto ? "short" : "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parseValor(s) {
    s = String(s || "").trim().replace(/[R$\s]/g, "");
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  function valorTxt(n) { return String(n).replace(".", ","); }
  function novoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dataBR(iso) { var p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; }
  function idade(iso) {
    var p = String(iso || "").split("-"); if (p.length !== 3) return "";
    var h = new Date(), n = h.getFullYear() - +p[0];
    if (h.getMonth() + 1 < +p[1] || (h.getMonth() + 1 === +p[1] && h.getDate() < +p[2])) n--;
    return n >= 0 && n < 100 ? n + " anos" : "";
  }
  function achar(id) { return state.alunos.find(function (x) { return x.id === id; }); }

  var CAMPOS = ["nome", "nasc", "escola", "serie", "turno", "trajeto", "resp", "tel", "contato2", "tel2", "cep", "rua", "num", "compl", "bairro", "cidade", "obs"];

  function endereco(a) {
    var l1 = [a.rua, a.num].filter(Boolean).join(", ");
    if (a.compl) l1 += (l1 ? " - " : "") + a.compl;
    var l2 = [a.bairro, a.cidade].filter(Boolean).join(", ");
    return [l1, l2, a.cep].filter(Boolean).join(" · ");
  }
  function enderecoBusca(a) { return [a.rua, a.num, a.bairro, a.cidade, a.cep, "Brasil"].filter(Boolean).join(", "); }
  function zap(t) {
    var d = String(t || "").replace(/\D/g, "");
    if (d.length < 10) return "";
    if (d.length <= 11) d = "55" + d;
    return "https://wa.me/" + d;
  }

  /* ---------- armazenamento ---------- */
  function setNota(t) { $("nota").textContent = t || ""; }

  // Os comprovantes ficam no IndexedDB deste navegador/aparelho.
  function abrirBancoArquivos() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("Este navegador não oferece IndexedDB.")); return; }
      var req = indexedDB.open("controle-da-van-arquivos", 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("comprovantes")) db.createObjectStore("comprovantes", { keyPath: "id" });
      };
      req.onsuccess = function () { dbArquivos = req.result; resolve(dbArquivos); };
      req.onerror = function () { reject(req.error || new Error("Falha ao abrir o armazenamento.")); };
    });
  }

  function salvarArquivo(f, tipo) {
    return new Promise(function (resolve, reject) {
      if (!dbArquivos) { reject(new Error("Armazenamento de arquivos indisponível.")); return; }
      var id = novoId();
      var tx = dbArquivos.transaction("comprovantes", "readwrite");
      tx.objectStore("comprovantes").put({ id: id, nome: f.name, tipo: tipo, blob: f });
      tx.oncomplete = function () { resolve(id); };
      tx.onerror = function () { reject(tx.error || new Error("Não foi possível salvar o comprovante.")); };
      tx.onabort = function () { reject(tx.error || new Error("O armazenamento recusou o arquivo.")); };
    });
  }

  function abrirComprovante(id) {
    var janela = window.open("about:blank", "_blank");
    if (!janela) { alert("Permita pop-ups para abrir o comprovante."); return; }
    if (!dbArquivos) { janela.close(); alert("O armazenamento de comprovantes não está disponível."); return; }
    var tx = dbArquivos.transaction("comprovantes", "readonly");
    var req = tx.objectStore("comprovantes").get(id);
    req.onsuccess = function () {
      if (!req.result || !req.result.blob) { janela.close(); alert("Comprovante não encontrado neste navegador."); return; }
      var url = URL.createObjectURL(req.result.blob);
      janela.location.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    };
    req.onerror = function () { janela.close(); alert("Não foi possível abrir o comprovante."); };
  }

  async function persist() {
    if (!docRef) { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} return; }
    dirty = true;
    if (saving) return;
    saving = true;
    while (dirty) {
      dirty = false;
      try { await docRef.set(clone(state)); setNota(""); }
      catch (e) { setNota("Não foi possível salvar agora. Confira a conexão e tente de novo."); }
    }
    saving = false;
  }

  function normaliza(d) {
    var alunos = (d && Array.isArray(d.alunos) ? d.alunos : []).map(function (a) {
      var o = { id: a.id, valor: +a.valor || 0, desde: a.desde || "", vencimento: +a.vencimento || 10, desconto: +a.desconto || 0, multa: +a.multa || 0, juros: +a.juros || 0, pagos: {} };
      CAMPOS.forEach(function (c) { o[c] = a[c] || ""; });
      Object.keys(a.pagos || {}).forEach(function (m) {
        var p = a.pagos[m];
        o.pagos[m] = typeof p === "number" ? { v: p, c: "", ct: "", t: "" } : { v: +p.v || 0, c: p.c || "", ct: p.ct || "", t: p.t || "" };
      });
      return o;
    });
    return { alunos: alunos, valorPadrao: (d && d.valorPadrao) || "", cidadePadrao: (d && d.cidadePadrao) || "" };
  }

  async function iniciar() {
    render();
    try { await abrirBancoArquivos(); }
    catch (e) { setNota("Não foi possível ativar o armazenamento de comprovantes. Abra o projeto pelo Live Server do VS Code."); }
    var db = null, user = null;
    try {
      if (window.claude && window.claude.use) {
        db = await window.claude.use("db");
        user = await window.claude.use("user");
      }
    } catch (e) {}
    var uid = null;
    try { uid = user ? await user.id() : null; } catch (e) {}

    if (db && uid) {
      docRef = db.doc("data/users/" + uid + "/van");
      var timer = setTimeout(function () { if (!loaded) setNota("Ainda sem resposta do armazenamento. Os dados podem estar desatualizados."); }, 10000);
      docRef.onSnapshot(function (snap) {
        if (!snap.metadata.fromCache) clearTimeout(timer);
        loaded = true;
        if (saving || dirty || snap.metadata.hasPendingWrites) { render(); return; }
        var d = snap.exists ? snap.data() : null;
        if (d && ui.tela !== "form" && !ui.enviando) state = normaliza(d);
        render();
      }, function () { loaded = true; setNota("Não foi possível ler os dados salvos."); render(); });
    } else {
      try { state = normaliza(JSON.parse(localStorage.getItem(LS) || "null")); } catch (e) {}
      loaded = true;
      setNota("Dados e comprovantes ficam salvos só neste aparelho e navegador.");
      render();
    }
  }

  /* ---------- tela: lista ---------- */
  function alunosDoMes() {
    return state.alunos.filter(function (a) { return !a.desde || a.desde <= ui.mes; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
  }

  function render() {
    var lista = ui.tela === "lista";
    var perfil = ui.tela === "perfil" || ui.tela === "form";
    $("telaLista").hidden = !lista;
    $("telaPerfil").hidden = !perfil;
    $("telaModulo").hidden = lista || perfil;
    document.querySelectorAll(".navmod button").forEach(function (b) { b.classList.toggle("navativo", b.dataset.tela === ui.tela); });
    if (perfil) { renderPerfil(); return; }
    if (!lista) { renderModulo(); return; }

    $("mesLbl").textContent = mesNome(ui.mes);
    $("hoje").hidden = ui.mes === mesKey(new Date());

    var todos = alunosDoMes(), rec = 0, pen = 0, qPago = 0;
    todos.forEach(function (a) {
      var p = a.pagos[ui.mes];
      if (p) { rec += p.v; qPago++; } else pen += a.valor;
    });
    $("sRec").textContent = fmt.format(rec);
    $("sPen").textContent = fmt.format(pen);
    $("sQtd").textContent = qPago + " de " + todos.length;
    $("bar").style.width = (todos.length ? Math.round((qPago / todos.length) * 100) : 0) + "%";
    document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.f === ui.filtro)); });

    var vis = todos.filter(function (a) {
      var pago = !!a.pagos[ui.mes];
      return ui.filtro === "todos" || (ui.filtro === "pago" ? pago : !pago);
    });

    var html;
    if (!loaded) html = '<li class="vazio">Carregando alunos…</li>';
    else if (!state.alunos.length) html = '<li class="vazio">Nenhum aluno cadastrado ainda.<br>Toque em <strong>+ Novo aluno</strong> para começar.</li>';
    else if (!todos.length) html = '<li class="vazio">Nenhum aluno ativo em ' + esc(mesNome(ui.mes)) + '.</li>';
    else if (!vis.length) html = '<li class="vazio">' + (ui.filtro === "pago" ? "Ninguém pagou ainda neste mês." : "Todos os alunos deste mês já pagaram.") + '</li>';
    else html = vis.map(linha).join("");
    $("lista").innerHTML = html;
  }

  function linha(a) {
    var p = a.pagos[ui.mes], pago = !!p;
    var aberto = ui.painel === a.id;
    var det = '<span class="num">' + fmt.format(a.valor) + '</span>' + (a.resp ? " · " + esc(a.resp) : "") + (a.turno ? " · " + esc(a.turno) : "");
    return '<li class="row' + (pago ? " pago" : "") + '" data-id="' + esc(a.id) + '">' +
      '<div><button class="nome" type="button" data-act="perfil">' + esc(a.nome) + '</button><div class="det">' + det + '</div></div>' +
      '<button class="status" type="button" data-act="status" aria-pressed="' + pago + '" aria-expanded="' + aberto + '">' + (pago ? "Pago" : "Não pago") + '</button>' +
      (aberto ? painelPag(a, p) : "") + '</li>';
  }

  function arquivoHtml(p) {
    if (!p || !p.c) return '<div class="det">Sem comprovante anexado.</div>';
    return '<button class="ghost" type="button" data-act="comprovante" data-comprovante="' + esc(p.c) + '">Abrir comprovante</button>';
  }

  function painelPag(a, p) {
    if (p) {
      return '<div class="pag"><div class="det">Pago <strong class="num">' + fmt.format(p.v) + '</strong>' + (p.t ? " em " + dataBR(p.t) : "") + '</div>' +
        arquivoHtml(p) +
        '<div class="acoes"><button class="danger' + (ui.desfazer ? " sure" : "") + '" type="button" data-act="desfazer">' + (ui.desfazer ? "Confirmar: desfazer pagamento" : "Desfazer pagamento") + '</button>' +
        '<button class="ghost" type="button" data-act="fechar">Fechar</button></div></div>';
    }
    var temAnexo = true;
    return '<div class="pag"><div class="f">' +
      '<label for="pgValor">Valor recebido (R$)<input id="pgValor" type="text" inputmode="decimal" value="' + esc(ui.pgValor) + '"></label>' +
      (temAnexo
        ? '<div class="arq"><input id="pgArq" type="file" accept="image/*,application/pdf"><label class="ghost" for="pgArq">' + (ui.arquivo ? "Trocar comprovante" : "Anexar comprovante") + '</label>' +
          '<span class="arqnome" id="pgArqNome">' + (ui.arquivo ? esc(ui.arquivo.name) : "Obrigatório para marcar como pago") + '</span></div>'
        : '<div class="det">O anexo de comprovante não está disponível nesta visualização.</div>') +
      '<div class="msg err" id="pgErro" role="alert">' + esc(ui.pgErro) + '</div>' +
      '<div class="acoes"><button class="primary" type="button" id="pgOk" data-act="confirmar"' + (temAnexo && !ui.arquivo || ui.enviando ? " disabled" : "") + '>' + (ui.enviando ? "Enviando…" : "Confirmar pagamento") + '</button>' +
      '<button class="ghost" type="button" data-act="fechar"' + (ui.enviando ? " disabled" : "") + '>Cancelar</button></div></div></div>';
  }

  function abrirPainel(a) {
    ui.painel = a.id; ui.pgValor = valorTxt(a.valor); ui.arquivo = null; ui.pgErro = ""; ui.desfazer = false;
  }
  function fecharPainel() { ui.painel = null; ui.arquivo = null; ui.pgErro = ""; ui.desfazer = false; }

  async function confirmarPagamento(a) {
    var v = parseValor(ui.pgValor);
    if (v === null) { ui.pgErro = "Digite um valor válido, como 250,00."; render(); return; }
    var info = { v: v, c: "", ct: "", t: new Date().toISOString() };
    var f = ui.arquivo;
    if (!f) { ui.pgErro = "Anexe o comprovante para marcar como pago."; render(); return; }
    var tipo = f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "");
    if (TIPOS_OK.indexOf(tipo) < 0) { ui.pgErro = "Formato não aceito. Use uma foto (JPG, PNG) ou PDF."; ui.arquivo = null; render(); return; }
    if (f.size > 20 * 1024 * 1024) { ui.pgErro = "O arquivo passa de 20 MB. Escolha um menor."; ui.arquivo = null; render(); return; }
    ui.enviando = true; ui.pgErro = ""; render();
    try {
      info.c = await salvarArquivo(f, tipo);
      info.ct = tipo;
    } catch (e) {
      ui.enviando = false;
      ui.pgErro = "Não foi possível salvar o comprovante neste navegador. Verifique o espaço disponível e tente novamente.";
      render(); return;
    }
    ui.enviando = false;
    a.pagos[ui.mes] = info;
    fecharPainel(); persist(); render();
  }

  $("lista").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var li = b.closest("li[data-id]");
    var a = li && achar(li.dataset.id);
    if (!a) return;
    var act = b.dataset.act;
    if (act === "perfil") { ui.tela = "perfil"; ui.alunoId = a.id; fecharPainel(); ui.remover = false; render(); window.scrollTo(0, 0); }
    else if (act === "status") { if (ui.painel === a.id) fecharPainel(); else abrirPainel(a); render(); }
    else if (act === "fechar") { fecharPainel(); render(); }
    else if (act === "confirmar") { confirmarPagamento(a); }
    else if (act === "comprovante") { abrirComprovante(b.dataset.comprovante); }
    else if (act === "desfazer") {
      if (!ui.desfazer) { ui.desfazer = true; render(); return; }
      delete a.pagos[ui.mes]; fecharPainel(); persist(); render();
    }
  });
  $("lista").addEventListener("input", function (e) { if (e.target.id === "pgValor") ui.pgValor = e.target.value; });
  $("lista").addEventListener("change", function (e) {
    if (e.target.id !== "pgArq") return;
    var f = e.target.files && e.target.files[0];
    ui.arquivo = f || null; ui.pgErro = "";
    render();
  });

  /* ---------- módulos financeiro e comunicação ---------- */
  function situacao(a, mes) {
    var p = a.pagos[mes];
    if (p) return { texto: "Pago", classe: "ok", valor: p.v };
    var hoje = new Date(), partes = mes.split("-");
    var venc = new Date(+partes[0], +partes[1]-1, Math.min(a.vencimento || 10, 28));
    var limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return venc < limite ? { texto: "Atrasado", classe: "bad", valor: 0 } : { texto: "Pendente", classe: "", valor: 0 };
  }
  function valorCobrado(a, mes) {
    var base = Math.max(0, a.valor - (a.desconto || 0));
    if (mes && situacao(a, mes).texto === "Atrasado") {
      var partes = mes.split("-"), venc = new Date(+partes[0], +partes[1]-1, Math.min(a.vencimento || 10, 28));
      var dias = Math.max(1, Math.floor((new Date().setHours(0,0,0,0) - venc.getTime()) / 86400000));
      base += (a.multa || 0) + (base * (a.juros || 0) / 100) * (dias / 30);
    }
    return Math.round(base * 100) / 100;
  }
  function resumoFinanceiro() {
    var ativos = alunosDoMes(), recebido = 0, previsto = 0, atrasado = 0, pendente = 0, pagos = 0;
    ativos.forEach(function(a) {
      var s = situacao(a, ui.mes), v = valorCobrado(a, ui.mes);
      if (s.texto === "Pago") { recebido += s.valor; pagos++; }
      else { previsto += v; if (s.texto === "Atrasado") atrasado += v; else pendente += v; }
    });
    return { ativos: ativos, recebido: recebido, previsto: previsto, atrasado: atrasado, pendente: pendente, pagos: pagos };
  }
  function renderModulo() {
    var box = $("telaModulo");
    if (ui.tela === "financeiro") {
      var r = resumoFinanceiro();
      box.innerHTML = '<div class="head"><div><h1>Financeiro</h1><p class="sub">Resumo de ' + esc(mesNome(ui.mes)) + '</p></div><div class="mes mini"><button class="ico" data-mod="ant">&#8249;</button><strong>' + esc(mesNome(ui.mes)) + '</strong><button class="ico" data-mod="prox">&#8250;</button></div></div>' +
        '<section class="resumo"><div class="cols"><div><div class="k">Recebido</div><div class="v ok num">' + fmt.format(r.recebido) + '</div></div><div><div class="k">A receber</div><div class="v num">' + fmt.format(r.previsto) + '</div></div><div><div class="k">Em atraso</div><div class="v bad num">' + fmt.format(r.atrasado) + '</div></div></div><div class="det">' + r.pagos + ' de ' + r.ativos.length + ' mensalidades pagas · ' + fmt.format(r.pendente) + ' ainda dentro do prazo</div></section>' +
        '<section class="card"><h2>Mensalidades do mês</h2><div class="tabela-fin">' + (r.ativos.length ? r.ativos.map(function(a) { var s=situacao(a,ui.mes); return '<div class="finlinha"><div><strong>' + esc(a.nome) + '</strong><div class="det">Vencimento dia ' + (a.vencimento || 10) + (a.desconto ? ' · Desconto ' + fmt.format(a.desconto) : '') + '</div></div><div class="finvalor"><strong>' + fmt.format(a.pagos[ui.mes] ? a.pagos[ui.mes].v : valorCobrado(a,ui.mes)) + '</strong><span class="pill ' + s.classe + '">' + s.texto + '</span></div></div>'; }).join('') : '<div class="vazio">Nenhum aluno ativo neste mês.</div>') + '</div></section>' +
        '<p class="nota">As mensalidades são calculadas a partir dos alunos ativos e das configurações de cada cadastro. Atraso é identificado pela data de vencimento.</p>';
    } else {
      var alunos = alunosDoMes();
      box.innerHTML = '<div><h1>WhatsApp</h1><p class="sub">Prepare mensagens personalizadas para os responsáveis.</p></div>' +
        '<section class="card f"><h2>Enviar mensagem</h2><label>Tipo de mensagem<select id="tipoMsg"><option value="lembrete">Lembrete de mensalidade</option><option value="atraso">Mensalidade em atraso</option><option value="vencimento">Aviso de vencimento</option><option value="horario">Alteração de horário</option><option value="geral">Comunicado geral</option></select></label>' +
        '<label>Aluno / responsável<select id="alvoMsg"><option value="">Selecione um aluno</option>' + alunos.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.nome)+' — '+esc(a.resp || 'Responsável não informado')+'</option>';}).join('') + '</select></label>' +
        '<label>Informações adicionais<textarea id="extraMsg" placeholder="Ex.: amanhã a saída será às 12h30..."></textarea></label>' +
        '<div class="det" id="prevMsg">A mensagem será preenchida com os dados do aluno.</div><button class="primary" type="button" id="abrirZap">Abrir WhatsApp com mensagem pronta</button><p class="nota">O WhatsApp será aberto para você revisar e enviar. O sistema não envia mensagens sozinho.</p></section>';
    }
  }
  function mensagemPara(a, tipo, extra) {
    var nome = a ? (a.resp || 'responsável') : 'responsáveis';
    var aluno = a ? a.nome : '';
    var mes = mesNome(ui.mes), valor = a ? fmt.format(valorCobrado(a)) : '';
    var venc = a ? (a.vencimento || 10) : '';
    var msgs = {
      lembrete: 'Olá, ' + nome + '! Tudo bem? Passando para lembrar que a mensalidade do transporte escolar de ' + aluno + ', referente a ' + mes + ', no valor de ' + valor + ', vence no dia ' + venc + '. Qualquer dúvida, estou à disposição!',
      atraso: 'Olá, ' + nome + '! Identificamos que a mensalidade do transporte escolar de ' + aluno + ', referente a ' + mes + ', no valor de ' + valor + ', está pendente. Se já realizou o pagamento, por favor, envie o comprovante.',
      vencimento: 'Olá, ' + nome + '! Lembramos que a mensalidade do transporte escolar de ' + aluno + ' vence no dia ' + venc + '. Obrigado!',
      horario: 'Olá, ' + nome + '! Temos uma atualização sobre o horário do transporte escolar de ' + aluno + ': ' + (extra || '[informe a alteração]'),
      geral: 'Olá, responsáveis! ' + (extra || '[escreva seu comunicado]')
    };
    return msgs[tipo] || msgs.geral;
  }

  /* ---------- tela: perfil e formulário ---------- */
  function renderPerfil() {
    var box = $("telaPerfil"), a = ui.alunoId && achar(ui.alunoId);
    if (ui.tela === "form") { box.innerHTML = formHtml(a); return; }
    if (!a) { ui.tela = "lista"; render(); return; }

    var p = a.pagos[ui.mes];
    var dd = function (k, v) { return v ? "<dt>" + k + "</dt><dd>" + v + "</dd>" : ""; };
    var tel = function (t) { var z = zap(t); return esc(t) + (z ? ' · <a href="' + z + '" target="_blank" rel="noopener">WhatsApp</a>' : ""); };
    var end = endereco(a);

    var meses = [], m = a.desde || ui.mes, hoje = mesKey(new Date()), n = 0;
    while (m <= hoje && n < 60) { meses.push(m); m = somaMes(m, 1); n++; }
    meses.reverse();
    var hist = meses.length ? '<ul class="hist">' + meses.slice(0, 24).map(function (mm) {
      var q = a.pagos[mm];
      return '<li><span>' + esc(mesNome(mm, true)) + '</span><span>' +
        (q ? '<span class="pill ok">Pago · ' + fmt.format(q.v) + '</span>' + (q.c ? ' <button class="ghost" type="button" data-act="comprovante" data-comprovante="' + esc(q.c) + '">Comprovante</button>' : "")
           : '<span class="pill bad">Pendente</span>') + '</span></li>';
    }).join("") + '</ul>' : '<div class="det">Sem mensalidades ainda.</div>';

    box.innerHTML =
      '<button class="voltar" type="button" data-act="voltar">&#8249; Voltar para a lista</button>' +
      '<div class="head"><div style="min-width:0"><h1>' + esc(a.nome) + '</h1><p class="sub">' + [a.escola, a.serie].filter(Boolean).map(esc).join(" · ") + '</p></div>' +
      '<button class="primary" type="button" data-act="editar">Editar</button></div>' +

      '<section class="card"><h2>Mensalidade</h2><dl class="info">' +
      dd("Valor mensal", '<span class="num">' + fmt.format(a.valor) + '</span>') +
      dd(esc(mesNome(ui.mes)), p ? '<span class="pill ok">Pago</span>' : '<span class="pill bad">Não pago</span>') +
      dd("Aluno desde", a.desde ? esc(mesNome(a.desde)) : "") + '</dl></section>' +

      '<section class="card"><h2>Aluno</h2><dl class="info">' +
      dd("Nascimento", a.nasc ? dataBR(a.nasc) + (idade(a.nasc) ? " (" + idade(a.nasc) + ")" : "") : "") +
      dd("Escola", esc(a.escola)) + dd("Série", esc(a.serie)) + dd("Turno", esc(a.turno)) + dd("Trajeto", esc(a.trajeto)) +
      '</dl></section>' +

      '<section class="card"><h2>Responsável e contatos</h2><dl class="info">' +
      dd("Responsável", esc(a.resp)) + dd("Telefone", a.tel ? tel(a.tel) : "") +
      dd("Outro contato", esc(a.contato2)) + dd("Telefone", a.tel2 ? tel(a.tel2) : "") +
      '</dl>' + (!a.resp && !a.tel ? '<div class="det">Nenhum contato cadastrado.</div>' : "") + '</section>' +

      '<section class="card"><h2>Endereço</h2>' +
      (end ? '<div class="end">' + esc(end) + '</div><div class="acoes" style="margin-top:12px">' +
        '<a class="primary" style="display:inline-flex;align-items:center;text-decoration:none" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(enderecoBusca(a)) + '" target="_blank" rel="noopener">Abrir no Google Maps</a>' +
        '<a class="ghost" href="https://waze.com/ul?q=' + encodeURIComponent(enderecoBusca(a)) + '&navigate=yes" target="_blank" rel="noopener">Abrir no Waze</a>' +
        '<button class="ghost" type="button" data-act="copiar" id="btnCopiar">Copiar endereço</button></div>'
       : '<div class="det">Endereço não cadastrado. Toque em Editar para adicionar.</div>') + '</section>' +

      (a.obs ? '<section class="card"><h2>Observações</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(a.obs) + '</div></section>' : "") +

      '<section class="card"><h2>Histórico de pagamentos</h2>' + hist + '</section>';
  }

  function sel(name, valor, opcoes) {
    return '<select id="f_' + name + '" name="' + name + '"><option value=""></option>' +
      opcoes.map(function (o) { return '<option' + (o === valor ? " selected" : "") + '>' + o + '</option>'; }).join("") + '</select>';
  }
  function inp(name, rotulo, valor, extra) {
    return '<label for="f_' + name + '">' + rotulo + '<input id="f_' + name + '" name="' + name + '" type="' + ((extra && extra.type) || "text") + '" value="' + esc(valor) + '"' +
      (extra && extra.req ? " required" : "") + (extra && extra.mode ? ' inputmode="' + extra.mode + '"' : "") + ' maxlength="120"' + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : "") + '></label>';
  }

  function formHtml(a) {
    var novo = !a;
    var d = a || { valor: "", cidade: state.cidadePadrao || "" };
    CAMPOS.forEach(function (c) { if (d[c] === undefined) d[c] = ""; });
    var valor = novo ? (state.valorPadrao || "") : valorTxt(d.valor);
    return '<button class="voltar" type="button" data-act="cancelarForm">&#8249; ' + (novo ? "Cancelar" : "Voltar sem salvar") + '</button>' +
      '<h1>' + (novo ? "Novo aluno" : "Editar perfil") + '</h1>' +
      '<form class="f" id="formAluno" autocomplete="off">' +
      '<section class="card f"><h2>Aluno</h2>' +
      inp("nome", "Nome do aluno", d.nome, { req: true, ph: "Ex.: João Pereira" }) +
      '<div class="dois">' + inp("nasc", "Data de nascimento", d.nasc, { type: "date" }) + inp("valor", "Valor mensal (R$)", valor, { req: true, mode: "decimal", ph: "Ex.: 250,00" }) + '</div>' +
      '<div class="dois">' + inp("vencimento", "Vencimento (dia do mês)", d.vencimento || 10, { mode: "numeric" }) + inp("desconto", "Desconto mensal (R$)", valorTxt(d.desconto || 0), { mode: "decimal" }) + '</div>' +
      '<div class="dois">' + inp("multa", "Multa por atraso (R$)", valorTxt(d.multa || 0), { mode: "decimal" }) + inp("juros", "Juros por atraso (% ao mês)", valorTxt(d.juros || 0), { mode: "decimal" }) + '</div>' +
      '<div class="dois">' + inp("escola", "Escola", d.escola) + inp("serie", "Série / ano", d.serie, { ph: "Ex.: 3º ano" }) + '</div>' +
      '<div class="dois"><label for="f_turno">Turno' + sel("turno", d.turno, ["Manhã", "Tarde", "Noite", "Integral"]) + '</label>' +
      '<label for="f_trajeto">Trajeto' + sel("trajeto", d.trajeto, ["Ida e volta", "Só ida", "Só volta"]) + '</label></div></section>' +

      '<section class="card f"><h2>Responsável e contatos</h2>' +
      '<div class="dois">' + inp("resp", "Responsável", d.resp) + inp("tel", "Telefone / WhatsApp", d.tel, { type: "tel", mode: "tel", ph: "(11) 99999-0000" }) + '</div>' +
      '<div class="dois">' + inp("contato2", "Outro contato (nome)", d.contato2, { ph: "Avó, tio, vizinho…" }) + inp("tel2", "Telefone do outro contato", d.tel2, { type: "tel", mode: "tel" }) + '</div></section>' +

      '<section class="card f"><h2>Endereço</h2>' +
      '<div class="dois">' + inp("rua", "Rua / avenida", d.rua) + inp("num", "Número", d.num, { mode: "numeric" }) + '</div>' +
      '<div class="dois">' + inp("compl", "Complemento", d.compl, { ph: "Apto, bloco, casa 2…" }) + inp("bairro", "Bairro", d.bairro) + '</div>' +
      '<div class="dois">' + inp("cidade", "Cidade", d.cidade) + inp("cep", "CEP", d.cep, { mode: "numeric", ph: "00000-000" }) + '</div></section>' +

      '<section class="card f"><h2>Observações</h2><label for="f_obs">Alergias, cuidados, quem pode buscar, pontos de referência' +
      '<textarea id="f_obs" name="obs" maxlength="1500">' + esc(d.obs) + '</textarea></label></section>' +

      '<div class="msg err" role="alert">' + esc(ui.erroForm) + '</div>' +
      '<div class="acoes"><button class="primary" type="submit">' + (novo ? "Adicionar aluno" : "Salvar") + '</button>' +
      (novo ? "" : '<button class="danger' + (ui.remover ? " sure" : "") + '" type="button" data-act="remover">' + (ui.remover ? "Confirmar: remover aluno e histórico" : "Remover aluno") + '</button>') +
      '</div></form>';
  }

  $("telaPerfil").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var a = ui.alunoId && achar(ui.alunoId), act = b.dataset.act;
    if (act === "comprovante") { abrirComprovante(b.dataset.comprovante); }
    else if (act === "voltar") { ui.tela = "lista"; ui.alunoId = null; render(); window.scrollTo(0, 0); }
    else if (act === "editar") { ui.tela = "form"; ui.erroForm = ""; ui.remover = false; render(); window.scrollTo(0, 0); }
    else if (act === "cancelarForm") { ui.erroForm = ""; ui.remover = false; ui.tela = a ? "perfil" : "lista"; render(); window.scrollTo(0, 0); }
    else if (act === "remover" && a) {
      if (!ui.remover) { ui.remover = true; render(); return; }
      state.alunos = state.alunos.filter(function (x) { return x.id !== a.id; });
      ui.remover = false; ui.alunoId = null; ui.tela = "lista"; persist(); render(); window.scrollTo(0, 0);
    }
    else if (act === "copiar" && a) {
      var t = enderecoBusca(a).replace(", Brasil", ""), btn = b;
      var ok = function () { btn.textContent = "Endereço copiado"; };
      var falha = function () {
        var r = document.createRange(), el = document.querySelector(".end");
        r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
        btn.textContent = "Selecionei o endereço, copie";
      };
      try { navigator.clipboard.writeText(t).then(ok, falha); } catch (err) { falha(); }
    }
  });

  $("telaPerfil").addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(e.target), g = function (k) { return String(fd.get(k) || "").trim(); };
    var nome = g("nome"), v = parseValor(g("valor"));
    if (!nome) { ui.erroForm = "Digite o nome do aluno."; render(); return; }
    if (v === null) { ui.erroForm = "Digite um valor válido, como 250,00."; render(); return; }
    var a = ui.alunoId && achar(ui.alunoId);
    if (!a) { a = { id: novoId(), desde: ui.mes, pagos: {} }; state.alunos.push(a); }
    CAMPOS.forEach(function (c) { a[c] = g(c); });
    a.valor = v;
    a.vencimento = Math.min(28, Math.max(1, parseInt(g("vencimento"), 10) || 10));
    a.desconto = parseValor(g("desconto")) || 0;
    a.multa = parseValor(g("multa")) || 0;
    a.juros = parseValor(g("juros")) || 0;
    state.valorPadrao = valorTxt(v);
    if (a.cidade) state.cidadePadrao = a.cidade;
    ui.alunoId = a.id; ui.tela = "perfil"; ui.erroForm = ""; ui.remover = false;
    persist(); render(); window.scrollTo(0, 0);
  });

  /* ---------- navegação ---------- */
  $("novo").addEventListener("click", function () { ui.alunoId = null; ui.tela = "form"; ui.erroForm = ""; fecharPainel(); render(); window.scrollTo(0, 0); });
  $("ant").addEventListener("click", function () { ui.mes = somaMes(ui.mes, -1); fecharPainel(); render(); });
  $("prox").addEventListener("click", function () { ui.mes = somaMes(ui.mes, 1); fecharPainel(); render(); });
  $("hoje").addEventListener("click", function () { ui.mes = mesKey(new Date()); fecharPainel(); render(); });
  document.querySelector(".seg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-f]");
    if (b) { ui.filtro = b.dataset.f; render(); }
  });

  document.querySelector(".navmod").addEventListener("click", function(e) {
    var b=e.target.closest("button[data-tela]"); if(!b) return;
    ui.tela=b.dataset.tela; fecharPainel(); render(); window.scrollTo(0,0);
  });
  $("telaModulo").addEventListener("click", function(e) {
    var b=e.target.closest("[data-mod],#abrirZap"); if(!b) return;
    if(b.dataset.mod) { ui.mes=somaMes(ui.mes,b.dataset.mod==="ant"?-1:1); render(); return; }
    var tipo=$("tipoMsg").value, alvo=$("alvoMsg").value, extra=$("extraMsg").value.trim();
    if(!alvo) { alert("Selecione um aluno."); return; }
    var a=achar(alvo), telefone=zap(a && a.tel);
    if(!telefone) { alert("Este aluno não possui um telefone/WhatsApp válido cadastrado."); return; }
    var texto=mensagemPara(a,tipo,extra);
    window.open(telefone+"?text="+encodeURIComponent(texto),"_blank","noopener");
  });
  $("telaModulo").addEventListener("change", function(e) {
    if(e.target.id==="tipoMsg" || e.target.id==="alvoMsg") {
      var tipo=$("tipoMsg").value, alvo=$("alvoMsg").value, a=achar(alvo);
      $("prevMsg").textContent=a?mensagemPara(a,tipo,$("extraMsg").value):"Selecione um aluno para visualizar a mensagem personalizada.";
    }
  });
  $("telaModulo").addEventListener("input", function(e) {
    if(e.target.id==="extraMsg" && $("tipoMsg").value==="geral") $("prevMsg").textContent=mensagemPara(null,"geral",e.target.value);
  });

  iniciar();
})();
