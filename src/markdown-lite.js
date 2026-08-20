/* markdown-lite.js — hand-rolled markdown subset (spec §4.2 Option B).
 * Covers: ATX headings, paragraphs, bold/italic/strikethrough, inline code,
 * fenced code, unordered/ordered lists (nested by indent), blockquotes,
 * tables, horizontal rules, images, standard links, raw HTML passthrough.
 * Exposes window.markdownLite(text) -> html.
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- fenced-code syntax highlighting -----------------------------------
  // Zero-dependency, ~40 lines. One master regex per language; alternation
  // order is the precedence (comments beat strings beat keywords). Unmatched
  // text is escaped verbatim, so a highlighter bug can only miscolor, never
  // corrupt or inject.
  var SQL_KW = 'SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|EXISTS|AS|CASE|WHEN|THEN|ELSE|END|GROUP|BY|ORDER|HAVING|DISTINCT|TOP|UNION|ALL|WITH|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|INDEX|DECLARE|EXEC|EXECUTE|COUNT|SUM|MIN|MAX|AVG|ISNULL|COALESCE|CAST|CONVERT|OVER|PARTITION|ROW_NUMBER|OBJECT_ID|DB_ID|ASC|DESC|ESCAPE|PIVOT|UNPIVOT';
  var LANGS = {
    sql: {
      re: new RegExp('(--[^\\n]*|/\\*[\\s\\S]*?\\*/)|(\'(?:[^\']|\'\')*\')|(\\[[^\\]\\n]*\\])|(@\\w+)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:' + SQL_KW + ')\\b)', 'gi'),
      cls: ['c', 's', 'i', 'v', 'n', 'k']
    },
    powershell: {
      re: /(<#[\s\S]*?#>|#[^\n]*)|("(?:`.|[^"`])*"|'[^']*')|(\$\w+|\$\([^)]*\))|(-\w+)|(\b\d+(?:\.\d+)?\b)|(\b(?:function|param|if|else|elseif|foreach|for|while|switch|return|throw|try|catch|finally|New-Object|Add-Type|Join-Path|Get-Content|Test-Path|Write-Host|Export-Csv|Out-GridView|Format-Table|Out-File|Invoke-Sql|Invoke-SqlScalar|ConvertFrom-Json)\b)/gi,
      cls: ['c', 's', 'v', 'p', 'n', 'k']
    }
  };
  LANGS.tsql = LANGS.sql;
  LANGS.ps1 = LANGS.powershell;

  function highlight(lang, src) {
    var def = LANGS[(lang || '').toLowerCase()];
    if (!def) return escapeHtml(src);
    var out = '', last = 0, m;
    def.re.lastIndex = 0;
    while ((m = def.re.exec(src))) {
      out += escapeHtml(src.slice(last, m.index));
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined) {
          out += '<span class="tok-' + def.cls[g - 1] + '">' + escapeHtml(m[g]) + '</span>';
          break;
        }
      }
      last = m.index + m[0].length;
    }
    return out + escapeHtml(src.slice(last));
  }

  // ---- inline rendering -------------------------------------------------
  function inline(text) {
    var codes = [];
    // protect inline code first
    text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, function (m, ticks, body) {
      codes.push('<code>' + escapeHtml(body.trim()) + '</code>');
      return '\uE000' + (codes.length - 1) + '\uE001';
    });
    // angle-bracket links/images: [x](<url or windows path with spaces>)
    // must run before HTML-tag protection or <C:\...> is mistaken for a tag
    text = text.replace(/(!?)\[([^\]]*)\]\(<([^<>\n]+)>\)/g, function (m, bang, label, href) {
      href = href.trim().replace(/^"+|"+$/g, '').replace(/"/g, '%22');
      if (bang) {
        codes.push('<img src="' + href + '" alt="' + label.replace(/"/g, '&quot;') + '">');
        return '\uE000' + (codes.length - 1) + '\uE001';
      }
      return '<a href="' + href + '">' + (label || escapeHtml(href)) + '</a>';
    });
    // protect inline HTML tags (passthrough — the viewer injects anchors/spans pre-parse)
    text = text.replace(/<\/?[a-zA-Z][^<>]*>/g, function (m) {
      codes.push(m);
      return '\uE000' + (codes.length - 1) + '\uE001';
    });
    text = escapeHtml(text);
    // images ![alt](src)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      '<img src="$2" alt="$1" title="$3">');
    // links [text](href) — empty text shows the href itself
    text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      function (m, label, href, title) {
        return '<a href="' + href + '" title="' + (title || '') + '">' + (label || href) + '</a>';
      });
    // bold, italic, strikethrough (bold before italic)
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![\w])/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // restore inline code
    text = text.replace(/\uE000(\d+)\uE001/g, function (m, i) { return codes[+i]; });
    return text;
  }

  // ---- block rendering ---------------------------------------------------
  function parse(src) {
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    function listBlock(indent) {
      var html = '', type = null, itemRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      var items = [];
      while (i < lines.length) {
        var m = itemRe.exec(lines[i]);
        if (m && m[1].length === indent) {
          var t = /\d/.test(m[2]) ? 'ol' : 'ul';
          if (!type) type = t;
          if (t !== type) break;
          items.push({ text: m[3], sub: '' });
          i++;
          // continuation / nested content
          while (i < lines.length) {
            var m2 = itemRe.exec(lines[i]);
            if (m2 && m2[1].length > indent) { items[items.length - 1].sub += listBlock(m2[1].length); continue; }
            if (m2 || /^\s*$/.test(lines[i]) || !/^\s+/.test(lines[i])) break;
            items[items.length - 1].text += ' ' + lines[i].trim(); i++;
          }
        } else break;
      }
      html = '<' + type + '>';
      for (var k = 0; k < items.length; k++)
        html += '<li>' + inline(items[k].text) + items[k].sub + '</li>';
      return html + '</' + type + '>';
    }

    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }

      // fenced code
      var f = /^(```|~~~)\s*(\S*)/.exec(line);
      if (f) {
        var buf = []; i++;
        while (i < lines.length && lines[i].indexOf(f[1]) !== 0) buf.push(lines[i++]);
        i++;
        out.push('<pre><code' + (f[2] ? ' class="language-' + escapeHtml(f[2]) + '"' : '') + '>' +
          highlight(f[2], buf.join('\n')) + '</code></pre>');
        continue;
      }
      // ATX heading
      var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      // horizontal rule
      if (/^ {0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) { out.push('<hr>'); i++; continue; }
      // blockquote
      if (/^\s*>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*> ?/, ''));
        out.push('<blockquote>' + parse(q.join('\n')) + '</blockquote>');
        continue;
      }
      // outline-numbered list: 1. / 1.1 / 1.2.3 — keeps literal numbers,
      // nests by number depth. Only takes over when the block contains at
      // least one multipart number; plain 1./2./3. falls through to listBlock.
      var numRe = /^\s*(\d+(?:\.\d+)+\.?|\d+[.)])\s+(.*)$/;
      if (numRe.test(line)) {
        var rows = [], j = i, multi = false, mm;
        while (j < lines.length && (mm = numRe.exec(lines[j]))) {
          var marker = mm[1].replace(/[.)]$/, '');
          if (marker.indexOf('.') !== -1) multi = true;
          rows.push({ num: mm[1], depth: marker.split('.').length - 1, text: mm[2] });
          j++;
        }
        if (multi) {
          var oHtml = '<ul class="outline">', oDepth = 0;
          rows.forEach(function (r) {
            while (oDepth < r.depth) { oHtml += '<ul class="outline">'; oDepth++; }
            while (oDepth > r.depth) { oHtml += '</ul>'; oDepth--; }
            oHtml += '<li><span class="onum">' + escapeHtml(r.num) + '</span> ' + inline(r.text) + '</li>';
          });
          while (oDepth-- >= 0) oHtml += '</ul>';
          out.push(oHtml);
          i = j;
          continue;
        }
      }
      // list
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
        out.push(listBlock(/^(\s*)/.exec(line)[1].length));
        continue;
      }
      // table: header row + separator row
      if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        var cells = function (l) {
          return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var head = cells(line); i += 2;
        var t = '<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
          t += '<tr>' + cells(lines[i]).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; i++;
        }
        out.push(t + '</tbody></table>');
        continue;
      }
      // tab-delimited table (Word/Excel paste): 2+ consecutive lines with tabs,
      // first row is the header
      if (line.indexOf('\t') !== -1 && i + 1 < lines.length && lines[i + 1].indexOf('\t') !== -1) {
        var trows = [];
        while (i < lines.length && lines[i].indexOf('\t') !== -1) {
          trows.push(lines[i++].split('\t').map(function (c) { return c.trim(); }));
        }
        var tt = '<table><thead><tr>' + trows[0].map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        for (var ri = 1; ri < trows.length; ri++)
          tt += '<tr>' + trows[ri].map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        out.push(tt + '</tbody></table>');
        continue;
      }
      // raw HTML block passthrough (needed for embed markers etc.)
      if (/^\s*<\/?(div|details|summary|table|thead|tbody|tr|td|th|p|ul|ol|li|blockquote|pre|h[1-6]|hr|section|article|figure|figcaption|video|audio|iframe)\b/i.test(line)) {
        var hb = [];
        while (i < lines.length && !/^\s*$/.test(lines[i])) hb.push(lines[i++]);
        out.push(hb.join('\n'));
        continue;
      }
      // paragraph
      var p = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6})\s|^(```|~~~)|^\s*>|^(\s*)([-*+]|\d+[.)])\s+|^\s*\d+(\.\d+)+\.?\s+/.test(lines[i]) &&
             lines[i].indexOf('\t') === -1)
        p.push(lines[i++]);
      // Obsidian-style: a single newline is a hard line break
      out.push('<p>' + inline(p.join('\n')).replace(/\n/g, '<br>\n') + '</p>');
    }
    return out.join('\n');
  }

  window.markdownLite = parse;
})();
