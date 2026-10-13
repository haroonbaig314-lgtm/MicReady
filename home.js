/* Verba home page: animations and page interactions. The live demo is in demo.js.
   Loaded with defer. */

// ── Scroll entrance animations (Intersection Observer) ──
(function () {
    // Skip entirely if user prefers reduced motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Skip if browser doesn't support IntersectionObserver
    if (!('IntersectionObserver' in window)) return;

    var STAGGER = 0.08; // seconds between each staggered child

    // Each entry: the section to watch, and which children inside it to animate
    var DEFS = [
        {
            root: '.problem',
            items: 'h2, .problem-card'
        },
        {
            root: '.features',
            items: 'h2, .feature-flip'
        },
        {
            root: '.how-it-works',
            items: 'h2, .how-it-works-subtitle'
        },
        {
            root: '.demo-section',
            items: '.demo-badge, h2, .demo-subtitle, .browser-note, .demo-card-wrap'
        },
        {
            root: '.comparison',
            items: 'h2, .comparison-subtitle, .comparison-table'
        },
        {
            root: '.testimonials',
            items: '.testimonials-container h2, .testimonials-subtitle, .testimonials-scroll-wrapper'
        },
        {
            root: '.final-cta',
            items: 'h2, p, .cta-buttons'
        },
        {
            root: '.faq',
            items: 'h2, .faq-subtitle, .faq-list'
        }
    ];

    DEFS.forEach(function (def) {
        var section = document.querySelector(def.root);
        if (!section) return;

        var items = Array.from(section.querySelectorAll(def.items));
        if (!items.length) return;

        // Mark each item as hidden with a staggered delay
        items.forEach(function (el, i) {
            el.classList.add('anim-hidden');
            el.style.transitionDelay = (i * STAGGER).toFixed(2) + 's';
        });

        // Observe the section; when it enters the viewport, reveal all children
        var obs = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) {
                items.forEach(function (el) {
                    el.classList.add('anim-visible');
                });
                obs.disconnect(); // animate once only
            }
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        });

        obs.observe(section);
    });
}());

/* ── How It Works timeline animation ── */
(function () {
    var section = document.querySelector('.how-it-works');
    if (!section) return;
    // If reduced motion, show everything immediately
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        section.classList.add('hiw-active');
        return;
    }
    var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
            section.classList.add('hiw-active');
            obs.disconnect();
        }
    }, { threshold: 0.3, rootMargin: '0px 0px -40px 0px' });
    obs.observe(section);
}());


/* ── FAQ accordion ── */
(function () {
    var items = Array.from(document.querySelectorAll('.faq-item'));
    if (!items.length) return;
    items.forEach(function (item) {
        var q = item.querySelector('.faq-question');
        var a = item.querySelector('.faq-answer');
        if (a && !a.id) { a.id = 'faq-answer-' + items.indexOf(item); }
        if (a) { q.setAttribute('aria-controls', a.id); }
        q.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); }
        });
        q.addEventListener('click', function () {
            var isOpen = item.classList.contains('open');
            items.forEach(function (i) {
                i.classList.remove('open');
                i.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                item.classList.add('open');
                item.querySelector('.faq-question').setAttribute('aria-expanded', 'true');
            }
        });
    });
}());

(function () {
    var wordEl = document.getElementById('fillerWord');
    var wrapEl = document.getElementById('fillerWrap');
    if (!wordEl || !wrapEl) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var words = ['um...', 'uh...', 'you know...', 'nervous pacing...'];
    var idx = 0;

    function runCycle() {
        // Hold visible for 900ms, then draw strikethrough
        setTimeout(function () {
            wrapEl.classList.add('striking');
            // After strikethrough finishes (450ms), fade out
            setTimeout(function () {
                wrapEl.style.opacity = '0';
                // After fade (350ms), swap word and fade back in
                setTimeout(function () {
                    idx = (idx + 1) % words.length;
                    wordEl.textContent = words[idx];
                    wrapEl.classList.remove('striking');
                    wrapEl.style.opacity = '';
                    runCycle();
                }, 350);
            }, 500);
        }, 900);
    }

    runCycle();
}());

(function () {
    var table = document.querySelector('.comparison-table table');
    if (!table) return;

    var elCoaching = document.getElementById('price-coaching');
    var elApps     = document.getElementById('price-apps');
    var elCourses  = document.getElementById('price-courses');
    var elVerba    = document.getElementById('price-verba');
    if (!elCoaching || !elApps || !elCourses || !elVerba) return;

    // Reduced-motion: show final values immediately, no animation
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        elCoaching.textContent = '$100+';
        elApps.textContent     = '$10 to $45';
        elCourses.textContent  = '$12+';
        elVerba.innerHTML      = '<strong>$6</strong>';
        elVerba.classList.add('price-land');
        return;
    }

    // Hide all four cells until the table enters view
    elCoaching.textContent = '';
    elApps.textContent     = '';
    elCourses.textContent  = '';
    elVerba.innerHTML      = '';

    var triggered = false;
    var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !triggered) {
            triggered = true;
            obs.unobserve(table);
            runOthers();
        }
    }, { threshold: 0.4 });
    obs.observe(table);

    // ── Phase 1: count Coaching, Apps, Courses over 1500ms simultaneously ──
    function runOthers() {
        var others = [
            { el: elCoaching, end: 100, suffix: '+' },
            { el: elApps,     end: 45,  from: 10 },     // a range: "$10 to $45"
            { el: elCourses,  end: 12,  suffix: '+' }
        ];
        var DURATION = 1500;
        var t0 = null;

        // Show "..." in Verba while others are counting
        elVerba.innerHTML = '<strong>...</strong>';
        elVerba.style.opacity = '1';

        function tick(ts) {
            if (t0 === null) t0 = ts;
            var elapsed = ts - t0;
            var progress = Math.min(elapsed / DURATION, 1);
            var eased = 1 - Math.pow(1 - progress, 3);

            others.forEach(function (p) {
                var val = Math.round(eased * p.end);
                p.el.textContent = p.from ? '$' + Math.round(eased * p.from) + ' to $' + val : '$' + val + (progress >= 1 ? p.suffix : '');
            });

            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                // Lock final values with suffixes, then wait before Verba
                elCoaching.textContent = '$100+';
                elApps.textContent     = '$10 to $45';
                elCourses.textContent  = '$12+';
                setTimeout(runVerba, 400);
            }
        }

        requestAnimationFrame(tick);
    }

    // ── Phase 2: fade in Verba cell (0.3s), then count $0→$6 over 3600ms ──
    function runVerba() {
        var FADE_DURATION = 300;
        var COUNT_DURATION = 3600;
        var landed = false;

        // Fade out then fade back in to signal count is starting
        elVerba.style.transition = 'opacity ' + FADE_DURATION + 'ms ease';
        elVerba.style.opacity = '0';

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                elVerba.style.opacity = '1';
            });
        });

        // Start counter after fade completes
        setTimeout(function () {
            elVerba.style.transition = '';
            var t0 = null;

            function tick(ts) {
                if (t0 === null) t0 = ts;
                var elapsed = ts - t0;
                var progress = Math.min(elapsed / COUNT_DURATION, 1);
                var eased = 1 - Math.pow(1 - progress, 3);
                var val = Math.round(eased * 6);

                elVerba.innerHTML = '<strong>$' + val + '</strong>';

                // Trigger emphasis the exact frame val first reaches 6
                if (!landed && val >= 6) {
                    landed = true;
                    elVerba.classList.add('price-land');
                    setTimeout(function () { elVerba.classList.remove('price-land'); }, 1000);
                }

                if (progress < 1) {
                    requestAnimationFrame(tick);
                }
            }

            requestAnimationFrame(tick);
        }, FADE_DURATION);
    }
}());

(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var MAX_TILT = 12;
    var cards = document.querySelectorAll('.testimonial-card');

    cards.forEach(function (card) {
        var shine = document.createElement('div');
        shine.className = 'card-shine';
        card.appendChild(shine);

        card.addEventListener('mouseenter', function () {
            card.style.transition = 'transform 0.15s ease-out, box-shadow 0.3s, border-color 0.3s';
        });

        card.addEventListener('mousemove', function (e) {
            var rect = card.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var dx = e.clientX - cx;
            var dy = e.clientY - cy;
            var rx = -(dy / (rect.height / 2)) * MAX_TILT;
            var ry =  (dx / (rect.width  / 2)) * MAX_TILT;

            card.style.transition = 'box-shadow 0.3s, border-color 0.3s';
            card.style.transform = 'perspective(1000px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) scale(1.02)';

            var px = ((e.clientX - rect.left) / rect.width)  * 100;
            var py = ((e.clientY - rect.top)  / rect.height) * 100;
            var tiltStrength = Math.sqrt(rx * rx + ry * ry) / MAX_TILT;
            shine.style.background = 'radial-gradient(circle at ' + px + '% ' + py + '%, rgba(255,255,255,' + (0.06 + tiltStrength * 0.14) + ') 0%, transparent 65%)';
            shine.style.opacity = '1';
        });

        card.addEventListener('mouseleave', function () {
            card.style.transition = 'transform 0.6s ease-out, box-shadow 0.3s, border-color 0.3s';
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            shine.style.opacity = '0';
        });
    });
}());

(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var RADIUS   = 80;
    var MAX_MOVE = 12;
    var LERP     = 0.12;

    var buttons = document.querySelectorAll('[data-magnetic]');

    buttons.forEach(function (btn) {
        var cx = 0, cy = 0, cs = 1;
        var tx = 0, ty = 0, ts = 1;
        var rafId = null;

        function tick() {
            cx += (tx - cx) * LERP;
            cy += (ty - cy) * LERP;
            cs += (ts - cs) * LERP;

            var done = Math.abs(tx - cx) < 0.05 && Math.abs(ty - cy) < 0.05 && Math.abs(ts - cs) < 0.002;
            if (done) {
                cx = tx; cy = ty; cs = ts;
                btn.style.transform = (tx === 0 && ty === 0 && ts === 1)
                    ? '' : 'translate(' + cx + 'px,' + cy + 'px) scale(' + cs + ')';
                rafId = null;
                return;
            }

            btn.style.transform = 'translate(' + cx + 'px,' + cy + 'px) scale(' + cs + ')';
            rafId = requestAnimationFrame(tick);
        }

        document.addEventListener('mousemove', function (e) {
            var rect = btn.getBoundingClientRect();
            var ocx  = rect.left + rect.width  / 2 - cx;
            var ocy  = rect.top  + rect.height / 2 - cy;
            var dx   = e.clientX - ocx;
            var dy   = e.clientY - ocy;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < RADIUS) {
                tx = (dx / RADIUS) * MAX_MOVE;
                ty = (dy / RADIUS) * MAX_MOVE;
                ts = 1.05;
            } else {
                tx = 0; ty = 0; ts = 1;
            }

            if (!rafId) rafId = requestAnimationFrame(tick);
        });
    });
}());

(function () {
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function showSuccess() {
        var el = document.getElementById('email-success');
        if (el) el.style.display = 'block';
    }

    function launchConfetti() {
        var section = document.querySelector('.email-capture');
        if (!section) return;

        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        function resize() {
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        // Burst origin: center of the email-capture section in viewport coords
        var rect = section.getBoundingClientRect();
        var ox = rect.left + rect.width  / 2;
        var oy = rect.top  + rect.height / 2;

        var COLORS = ['#1e3a2e', '#2d5a44', '#4caf7d', '#a8d5b5', '#ffffff', '#e8f5e9'];
        var COUNT  = 90;
        var DURATION = 3000; // ms

        var particles = [];
        for (var i = 0; i < COUNT; i++) {
            var angle = Math.random() * Math.PI * 2;
            var speed = 4 + Math.random() * 7;
            particles.push({
                x:    ox,
                y:    oy,
                vx:   Math.cos(angle) * speed,
                vy:   Math.sin(angle) * speed - (3 + Math.random() * 4), // bias upward
                w:    6 + Math.random() * 6,
                h:    3 + Math.random() * 4,
                rot:  Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 0.25,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                alpha: 1
            });
        }

        var t0 = null;
        function draw(ts) {
            if (t0 === null) t0 = ts;
            var elapsed  = ts - t0;
            var progress = elapsed / DURATION;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            var alive = false;
            particles.forEach(function (p) {
                p.vy  += 0.18;          // gravity
                p.x   += p.vx;
                p.y   += p.vy;
                p.rot += p.spin;
                p.alpha = Math.max(0, 1 - progress * 1.3);

                if (p.alpha <= 0) return;
                alive = true;

                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            });

            if (alive && elapsed < DURATION + 500) {
                requestAnimationFrame(draw);
            } else {
                window.removeEventListener('resize', resize);
                canvas.parentNode && canvas.parentNode.removeChild(canvas);
            }
        }
        requestAnimationFrame(draw);
    }

    var fired = false;
    window.addEventListener('message', function (e) {
        if (fired) return;
        // Beehiiv posts various shapes — check for subscription success
        var d = e.data;
        if (!d) return;
        var isSuccess = false;
        if (typeof d === 'string') {
            try { d = JSON.parse(d); } catch (err) { /* not JSON */ }
        }
        if (typeof d === 'object' && d !== null) {
            // Beehiiv success event shapes seen in the wild
            isSuccess = d.type === 'beehiiv:subscribe:success'
                     || d.type === 'subscribe:success'
                     || d.event === 'subscribe'
                     || d.action === 'subscribe'
                     || d.subscribed === true;
        }
        if (!isSuccess) return;
        fired = true;
        showSuccess();
        if (!reducedMotion) launchConfetti();
    });
}());

/* ── Problem section: animated strikethrough ── */
(function () {
    var section = document.querySelector('.problem');
    if (!section) return;

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var cards = [
        { strike: document.getElementById('prob-strike-0'), sol: document.getElementById('prob-sol-0') },
        { strike: document.getElementById('prob-strike-1'), sol: document.getElementById('prob-sol-1') },
        { strike: document.getElementById('prob-strike-2'), sol: document.getElementById('prob-sol-2') },
    ];

    var pendingTimers = [];

    function animateCard(card) {
        if (!card.strike || !card.sol) return;
        card.strike.classList.add('struck');
        if (reducedMotion) {
            card.sol.classList.add('visible');
        } else {
            pendingTimers.push(setTimeout(function () { card.sol.classList.add('visible'); }, 800));
        }
    }

    var obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect(); // fire once only
        if (reducedMotion) {
            cards.forEach(function (card) { animateCard(card); });
        } else {
            pendingTimers.push(setTimeout(function () { animateCard(cards[0]); }, 1200));
            pendingTimers.push(setTimeout(function () { animateCard(cards[1]); }, 2000));
            pendingTimers.push(setTimeout(function () { animateCard(cards[2]); }, 2800));
        }
    }, { threshold: 0.4 });
    obs.observe(section);
}());



/* ── Feature cards: keyboard focusable (CSS :focus-within flips them) ── */
(function () {
    Array.prototype.forEach.call(document.querySelectorAll('.feature-flip'), function (card) {
        card.setAttribute('tabindex', '0');
    });
}());
/* ── Feature card flip: tap to flip on touch devices ── */
(function () {
    if (!window.matchMedia('(hover: none)').matches) return; // desktop uses CSS :hover
    var cards = Array.from(document.querySelectorAll('.feature-flip'));
    cards.forEach(function (card) {
        card.addEventListener('click', function () {
            var isFlipped = card.classList.contains('flipped');
            // Unflip all cards first
            cards.forEach(function (c) { c.classList.remove('flipped'); });
            // If this card wasn't already flipped, flip it now
            if (!isFlipped) {
                card.classList.add('flipped');
            }
        });
    });
}());

/* ── Comparison table: tooltip hints ── */
(function () {
    var isTouchDevice = window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (!isTouchDevice) return; // hover handled by CSS; only need JS for touch

    var openCell = null;

    document.addEventListener('click', function (e) {
        var info = e.target.closest('.feat-info');
        if (info) {
            var cell = info.closest('.feat-cell');
            if (!cell) return;
            if (openCell && openCell !== cell) openCell.classList.remove('tip-open');
            cell.classList.toggle('tip-open');
            openCell = cell.classList.contains('tip-open') ? cell : null;
            e.stopPropagation();
            return;
        }
        // Tap anywhere else closes open tooltip
        if (openCell) {
            openCell.classList.remove('tip-open');
            openCell = null;
        }
    });
}());

/* ── Transparent nav: becomes solid once scrolled past hero ── */
(function () {
    var header = document.querySelector('header');
    var hero = document.querySelector('.hero');
    if (!header || !hero) return;
    function onScroll() {
        var heroBottom = hero.getBoundingClientRect().bottom + (window.scrollY || window.pageYOffset);
        if ((window.scrollY || window.pageYOffset) > heroBottom - header.offsetHeight) {
            header.classList.add('nav-scrolled');
        } else {
            header.classList.remove('nav-scrolled');
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}());
