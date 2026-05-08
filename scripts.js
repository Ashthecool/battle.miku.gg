lucide.createIcons();

        // ── Global card data ──────────────────────────────────────────────────────
        // Declared at the top level so all functions (draw, renderVault, endTurn, etc.)
        // can reference ALL_CHARS before loadCards() finishes resolving.
        let ALL_CHARS = [];

        // ── Supabase config ──────────────────────────────────────────────────────
        const SUPABASE_URL    = 'https://djknvuaivmtudiecwztx.supabase.co';
        const SUPABASE_KEY    = 'sb_publishable_oKPY6OIcovoVQlLZqBOLMg_skAxeCwp';
        const SUPABASE_BUCKET = 'card-images';

        window.supabaseStorageUrl = function(path) {
            return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${path}`;
        };

        // ── Battle log function ──────────────────────────────────────────────────────
        function log(text) {
            const entry = document.createElement('div');
            entry.textContent = text;
            entry.classList.add('battle-log-entry');
            const logEl = document.getElementById('battle-log-entries');
            logEl.appendChild(entry);
            logEl.scrollTop = logEl.scrollHeight;
        }

        // Builds the ordered list of candidate URLs to try for a card image:
        // 1. name-with-hyphens.png  2. name_with_underscores.png
        // 3. name-with-hyphens.jpg  4. name_with_underscores.jpg
        function getCardImageCandidates(name) {
            const hyphen    = name.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            const underscore = name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
            return [
                supabaseStorageUrl(`${hyphen}.png`),
                supabaseStorageUrl(`${underscore}.png`),
                supabaseStorageUrl(`${hyphen}.jpg`),
                supabaseStorageUrl(`${underscore}.jpg`),
            ];
        }

        // Primary URL (first candidate — hyphen .png)
        function getCardImage(name) {
            return getCardImageCandidates(name)[0];
        }

        // Legacy fallback — hyphen .jpg (kept for any direct callers)
        function getCardImageJpg(name) {
            const base = name.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            return supabaseStorageUrl(`${base}.jpg`);
        }

        // Called by onerror on card <img> elements to walk the candidate list.
        // Uses a data attribute to track position so DOM URL normalization
        // doesn't break indexOf comparisons.
        window.cardImageFallback = function(img, name) {
            // Deduplicate candidates (single-word names produce identical hyphen/underscore URLs)
            const seen = new Set();
            const candidates = getCardImageCandidates(name).filter(u => seen.has(u) ? false : seen.add(u));
            const next = parseInt(img.dataset.imgFallbackIdx || '0', 10) + 1;
            if (next < candidates.length) {
                img.dataset.imgFallbackIdx = next;
                img.src = candidates[next];
            }
            // Exhausted all candidates — leave as broken image
        };

        function cloneCard(card) {
            return { ...card, image: card.image, imageFallback: card.imageFallback, maxHp: card.maxHp ?? card.hp };
        }

        function resolveEffectValue(value, card, context = {}) {
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                try {
                    return new Function('card', 'context', 'Math', `return ${value}`)(card, context, Math);
                } catch (e) {
                    console.warn('Ability value parse failed:', value, e);
                }
            }
            return 0;
        }

        function findBoardForContext(context = {}) {
            if (context.board) return context.board;
            if (context.side === 'enemy') return state.eBoard;
            if (context.side === 'player') return state.pBoard;
            return null;
        }

        function getOpposingBoard(context = {}) {
            if (context.opponentBoard) return context.opponentBoard;
            if (context.side === 'player') return state.eBoard;
            if (context.side === 'enemy') return state.pBoard;
            return state.eBoard;
        }

        function isCardOnBoard(board, cardName) {
            return board.some(slot => slot && slot.card && slot.card.name === cardName);
        }

        // Helper to pause the game engine for a set number of milliseconds
        const delay = ms => new Promise(res => setTimeout(res, ms));

        function evaluateScenario(scenario, unit, context = {}) {
                    // If no scenario exists, return 1 (true) so default cards still trigger
                    if (!scenario) return 1;

                    // 1. Determine which board to check
                    // If side is specified in scenario, use that. 
                    // If not specified, default to the acting unit's board (the board passed in context)
                    const board = scenario.side
                        ? ((scenario.side === 'player') ? state.pBoard : state.eBoard)
                        : (findBoardForContext(context) || state.pBoard);
                    
                    // --- Handle "unitCount" logic (e.g., "less than 2 units on the board") ---
                    if (scenario.type === 'unitCount' || scenario.type === 'unitCountValue') {
                        // Count how many non-empty slots exist on that board
                        const currentCount = board.filter(slot => slot !== null).length;

                        if (scenario.type === 'unitCountValue') {
                            const multiplier = resolveEffectValue(scenario.value || 1, unit.card, context);
                            return currentCount * multiplier;
                        }

                        const threshold = scenario.threshold || 0;
                        let success = false;

                        if (scenario.operator === 'less') success = currentCount < threshold;
                        else if (scenario.operator === 'greater') success = currentCount > threshold;
                        else if (scenario.operator === 'equal') success = currentCount === threshold;

                        return success ? (scenario.positive ?? 1) : (scenario.negative ?? 0);
                    }

                    if (scenario.type === 'attackedCount') {
                        const currentCount = unit?.status?.timesAttacked || 0;
                        const threshold = scenario.threshold || 0;
                        let success = false;

                        if (scenario.operator === 'less') success = currentCount < threshold;
                        else if (scenario.operator === 'greater') success = currentCount > threshold;
                        else if (scenario.operator === 'equal') success = currentCount === threshold;

                        return success ? (scenario.positive ?? 1) : (scenario.negative ?? 0);
                    }
                    // -------------------------------------------------------------------

                    // 2. Get the list of names
                    const names = scenario.cards || scenario.cardNames || [];
                    if (!Array.isArray(names)) return 0;

                    // 3. Count exactly how many of each target card are on the board
                    const counts = names.map(name => {
                        return board.filter(slot => slot && slot.card && slot.card.name === name).length;
                    });

                    // 4. Handle "Each" logic
                    if (scenario.type === 'each') {
                        // Sum the total occurrences across all target names
                        const totalMatches = counts.reduce((sum, count) => sum + count, 0);
                        const multiplier = resolveEffectValue(scenario.value || 1, unit.card, context);
                        return totalMatches * multiplier;
                    }

                    // 5. Handle "And/Or" logic (success if count is greater than 0)
                    const success = (scenario.type === 'and' || scenario.type === 'all') 
                        ? counts.every(count => count > 0) 
                        : counts.some(count => count > 0);

                    return success ? (scenario.positive ?? 1) : (scenario.negative ?? 0);
                }

        function buildAbilityContext(context = {}) {
                const board = context.board || findBoardForContext(context) || state.pBoard;
                const side = context.side || (board === state.eBoard ? 'enemy' : 'player');
                const opponentBoard = context.opponentBoard || getOpposingBoard({ ...context, side, board });
                return { ...context, side, board, opponentBoard };
        }

        function getBoardSide(board) {
                if (board === state.eBoard) return 'enemy';
                return 'player';
        }

        async function resolveBoardUnitDeath(unit, board, idx) {
                if (!unit || !board || idx === undefined || idx === null || unit.card.hp > 0) return;

                const side = getBoardSide(board);
                await triggerCardEvent('onDeath', unit, { slot: idx, side, board });

                if (board[idx] === unit && unit.card.hp <= 0) {
                    board[idx] = null;
                }
        }

        async function applyCardEffect(effect, unit, context = {}) {
                context = buildAbilityContext(context);
                // STOP effect here if the scenario didn't succeed (equals 0)
                if (context.scenario === 0) {
                    console.log('Scenario blocked effect', effect, context);
                    return false;
                }

                const card = unit.card;
                const amount = resolveEffectValue(effect.value ?? effect.amount ?? effect.damage ?? 0, card, context);

            switch (effect.type) {
                case 'healNexus':
                    if (context.side === 'enemy') {
                        state.eHp = Math.min(30, state.eHp + amount);
                        log(`${card.name.toUpperCase()} HEALS THE ENEMY NEXUS FOR ${amount}.`);
                        animateCard(document.getElementById('enemy-hp'), 'animate-heal');
                    } else {
                        state.pHp = Math.min(30, state.pHp + amount);
                        log(`${card.name.toUpperCase()} HEALS YOUR NEXUS FOR ${amount}.`);
                        animateCard(document.getElementById('player-hp'), 'animate-heal');
                    }
                    break;
                case 'berserkOverflow': {
                    const overflow = Math.max(0, amount);
                    if (overflow > 0) {
                        if (context.side === 'enemy') {
                            state.pHp -= overflow;
                            log(`BERSERK OVERFLOW: ${overflow} DMG TO YOUR NEXUS`);
                            animateCard(document.getElementById('player-hp'), 'animate-ability');
                        } else {
                            state.eHp -= overflow;
                            log(`BERSERK OVERFLOW: ${overflow} DMG TO ENEMY NEXUS`);
                            animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                        }
                    }
                    break;
                }
                case 'splashAdjacent':
                    [context.targetIdx - 1, context.targetIdx + 1].forEach(adj => {
                        if (context.board && context.board[adj]) {
                            context.board[adj].card.hp -= amount;
                            if (context.board[adj].card.hp <= 0) {
                                log(`${context.board[adj].card.name} TAKES SPLASH AND DIES`);
                                context.board[adj] = null;
                            } else {
                                log(`${context.board[adj].card.name} TAKES SPLASH`);
                            }
                        }
                    });
                    animateCard(document.getElementById(context.side === 'enemy' ? 'player-hp' : 'enemy-hp'), 'animate-ability');
                    break;
                case 'silenceTarget': {
                    const targetUnit = context.target || unit; // Use the target if provided, else the unit itself
                    if (targetUnit) {
                        if (!targetUnit.status) targetUnit.status = {};
                        
                        // Change from 'true' to 'amount' to support multiple turns
                        targetUnit.status.silenced = (targetUnit.status.silenced || 0) + amount;
                        
                        log(`${targetUnit.card.name.toUpperCase()} IS SILENCED FOR ${amount} TURNS.`);
                        
                        if (context.targetIdx !== undefined) {
                            const side = context.side === 'player' ? 'enemy' : 'player';
                            animateCard(getSlotCard(side, context.targetIdx), 'animate-ability');
                        }
                    }
                    break;
                }
                case 'disableTarget':
                    if (context.target) {
                        context.target.status.exhausted = true;
                        log(`${context.target.card.name.toUpperCase()} IS DISABLED.`);
                        if (context.targetIdx !== undefined) {
                            const disableSide = context.side === 'player' ? 'enemy' : 'player';
                            animateCard(getSlotCard(disableSide, context.targetIdx), 'animate-ability');
                        }
                    }
                    break;
                case 'drawCard':
                    if (context.side !== 'enemy') {
                        for (let i = 0; i < Math.max(1, amount); i++) draw();
                        log(`${card.name.toUpperCase()} DRAWS ${Math.max(1, amount)} CARD(S).`);
                    }
                    break;
                case 'healSelf': {
                    const healed = Math.min(unit.card.maxHp, unit.card.hp + amount) - unit.card.hp;
                    if (healed > 0) {
                        unit.card.hp += healed;
                        log(`${card.name.toUpperCase()} HEALS THEMSELF FOR ${healed}.`);
                        if (context.side !== undefined && context.slot !== undefined) {
                            animateCard(getSlotCard(context.side, context.slot), 'animate-heal');
                            updateCardStats(context.side, context.slot);
                        }
                    }
                    break;
                }
                case 'attackUpSelf':
                    unit.card.atk += amount;
                    log(`${card.name.toUpperCase()} ATTACK INCREASED BY ${amount}.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                        updateCardStats(context.side, context.slot);
                    }
                    break;
                    
                case 'snipeDamage':
                    if (context.target && context.target.card) {
                        context.target.card.hp -= amount;
                        log(`${card.name.toUpperCase()} SNIPES ${context.target.card.name.toUpperCase()} FOR ${amount} DAMAGE.`);
                        const snipeOppSide = context.side === 'player' ? 'enemy' : 'player';
                        const snipeOppBoard = snipeOppSide === 'enemy' ? state.eBoard : state.pBoard;
                        const snipeTargetIdx = snipeOppBoard.indexOf(context.target);
                        if (snipeTargetIdx !== -1) updateCardStats(snipeOppSide, snipeTargetIdx);
                    }
                    break;
                case 'healAllies':
                    for (let i = 0; i < context.board.length; i++) {
                        if (context.board[i] && context.board[i].card) {
                            const ally = context.board[i].card;
                            const healed = Math.min(ally.maxHp, ally.hp + amount) - ally.hp;
                            if (healed > 0) {
                                ally.hp += healed;
                                log(`${ally.name.toUpperCase()} HEALS FOR ${healed}.`);
                                updateCardStats(context.side, i);
                            }
                        }
                    }
                    break;
                case 'dealDamageAllEnemies': {
                    const enemyBoard = getOpposingBoard(context) || [];
                    const enemyBoardSide = getBoardSide(enemyBoard);
                    console.log(`${card.name} dealing ${amount} damage to all enemies. Enemy board has ${enemyBoard.filter(u => u).length} units.`);
                    for (let i = 0; i < enemyBoard.length; i++) {
                        const target = enemyBoard[i];
                        if (target && target.card) {
                            target.card.hp -= amount;
                            if (target.card.hp <= 0) {
                                log(`${target.card.name.toUpperCase()} TAKES ${amount} DAMAGE AND DIES.`);
                                await triggerCardEvent('onDeath', target, { slot: i, side: enemyBoardSide, board: enemyBoard });
                                if (enemyBoard[i] === target && target.card.hp <= 0) {
                                    enemyBoard[i] = null;
                                }
                            } else {
                                log(`${target.card.name.toUpperCase()} TAKES ${amount} DAMAGE.`);
                                updateCardStats(enemyBoardSide, i);
                            }
                        }
                    }
                    break;
                }
                case 'damageRandomEnemy': {
                    const enemyBoard = getOpposingBoard(context) || [];
                    const candidates = enemyBoard
                        .map((target, idx) => target && target.card ? { target, idx } : null)
                        .filter(Boolean);

                    if (candidates.length === 0) break;

                    const victimPick = candidates[Math.floor(Math.random() * candidates.length)];
                    const victim = victimPick.target;
                    victim.card.hp -= amount;
                    log(`${card.name.toUpperCase()} HITS ${victim.card.name.toUpperCase()} FOR ${amount} DAMAGE.`);

                    if (victim.card.hp <= 0) {
                        log(`${victim.card.name.toUpperCase()} DIES.`);
                        await resolveBoardUnitDeath(victim, enemyBoard, victimPick.idx);
                    } else {
                        const dmgRndSide = getBoardSide(enemyBoard);
                        updateCardStats(dmgRndSide, victimPick.idx);
                    }
                    break;
                }
                case 'hpUpSelf':
                    unit.card.maxHp += amount; // Raise the ceiling
                    unit.card.hp += amount;    // Add the health
                    log(`${card.name.toUpperCase()} GAINS +${amount} MAX HP.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-heal');
                        updateCardStats(context.side, context.slot);
                    }
                    break;
                
                case 'discountHandBySeries':
                    if (context.side === 'enemy') break; // Enemy has no hand to discount
                    let discountedCount = 0;
                    
                    // THE TOGGLE: Check if the effect specifies 'all' or if the series property is missing
                    const isAllCards = !effect.series || effect.series.toLowerCase() === 'all';
                    
                    // Loop through every card currently in the player's hand
                    state.hand.forEach(handCard => {
                        // Discount if it's set to "all", OR if the specific series matches
                        if (isAllCards || handCard.series === effect.series) {
                            handCard.cost = Math.max(0, handCard.cost - amount);
                            discountedCount++;
                        }
                    });
                    
                    if (discountedCount > 0) {
                        // Change the log message based on the toggle
                        const logText = isAllCards ? "CARD(S)" : `${effect.series.toUpperCase()} CARD(S)`;
                        log(`${card.name.toUpperCase()} REDUCED THE COST OF ${discountedCount} ${logText}.`);
                    }
                    break;
                    
                case 'valuePerSeriesInEnemyBoard': {
                    let seriesTotal = 0;
                    
                    // 1. Check the opposing board based on who is acting
                    const targetBoard = getOpposingBoard(context); // This makes it work for both Player and AI
                    
                    // 2. Loop through the units
                    targetBoard.forEach(unit => {
                        // 3. Drill down into unit.card.series
                        if (unit && unit.card && unit.card.series === effect.series) {
                            seriesTotal += amount;
                        }
                    });

                    // 4. Store it in context so the NEXT effect in the array can use it
                    context.scenario = seriesTotal; 
                    log(`SCALING: Found ${seriesTotal / amount} units from ${effect.series}. Value is ${seriesTotal}.`);
                    break;
                }

                case 'spawnCard':
                    if (context.side === 'enemy') {
                        // Enemies have no hand — redirect to placing directly on the board
                        const spawnNameE = effect.cardName;
                        const spawnQtyE = resolveEffectValue(effect.amount || 1, card, context);
                        const spawnTemplateE = ALL_CHARS.find(c => c.name === spawnNameE);
                        if (spawnTemplateE) {
                            let spawnedE = 0;
                            for (let i = 0; i < spawnQtyE; i++) {
                                const emptyIdx = state.eBoard.findIndex(slot => slot === null);
                                if (emptyIdx !== -1) {
                                    state.eBoard[emptyIdx] = {
                                        card: cloneCard(spawnTemplateE),
                                        status: { exhausted: true, justPlayed: true, silenced: false }
                                    };
                                    await triggerCardEvent('onPlay', state.eBoard[emptyIdx], {
                                        slot: emptyIdx, side: 'enemy', board: state.eBoard
                                    });
                                    spawnedE++;
                                }
                            }
                            if (spawnedE > 0) log(`${card.name.toUpperCase()} SUMMONED ${spawnedE} ${spawnNameE.toUpperCase()}(S) TO ENEMY BOARD.`);
                        } else {
                            console.warn(`Card to spawn not found: ${spawnNameE}`);
                        }
                        break;
                    }

                    const spawnName = effect.cardName;
                    // Resolve the amount (allows for dynamic math or just a flat number)
                    const spawnQty = resolveEffectValue(effect.amount || 1, card, context);
                    // Find the card template from the main database
                    const targetCard = ALL_CHARS.find(c => c.name === spawnName);
                    
                    if (targetCard) {
                        let spawnedCount = 0;
                        for (let i = 0; i < spawnQty; i++) {
                            // Check if the player has room in their hand (max 4)
                            if (state.hand.length < 4) { 
                                state.hand.push({ ...targetCard, maxHp: targetCard.hp });
                                spawnedCount++;
                            }
                        }
                        if (spawnedCount > 0) {
                            log(`${card.name.toUpperCase()} SPAWNED ${spawnedCount} ${spawnName.toUpperCase()}(S) INTO HAND.`);
                            // updateBattleUI() is usually called by the parent function, 
                            // but if you notice it not updating immediately, you can uncomment the line below:
                            // updateBattleUI(); 
                        } else {
                            log(`HAND FULL. COULD NOT SPAWN ${spawnName.toUpperCase()}.`);
                        }
                    } else {
                        console.warn(`Card to spawn not found: ${spawnName}`);
                    }
                    break;
                case 'spawnOnBoard': {
                    const summonName = effect.cardName;
                    const summonQty = resolveEffectValue(effect.amount || 1, card, context);
                    const summonTemplate = ALL_CHARS.find(c => c.name === summonName);

                    if (summonTemplate) {
                        // FIX: Use the board provided in context (passed from await triggerCardEvent)
                        // If no board in context, default to player board
                        const targetBoard = context.board || state.pBoard;
                        const sideName = (targetBoard === state.pBoard) ? "PLAYER" : "ENEMY";

                        let count = 0;
                        for (let i = 0; i < summonQty; i++) {
                            const emptyIdx = targetBoard.findIndex(slot => slot === null);
                            if (emptyIdx !== -1) {
                                targetBoard[emptyIdx] = { 
                                    card: cloneCard(summonTemplate),
                                    status: { exhausted: true, justPlayed: true, silenced: false } 
                                };
                                await triggerCardEvent('onPlay', targetBoard[emptyIdx], {
                                    slot: emptyIdx,
                                    side: getBoardSide(targetBoard),
                                    board: targetBoard
                                });
                                count++;
                            }
                        }
                        if (count > 0) {
                            log(`${card.name.toUpperCase()} SUMMONED ${count} ${summonName.toUpperCase()}(S) TO ${sideName} BOARD.`);
                        }
                    }
                    break;
                    // --- New Abilities ---
                }
                case 'giveAllAlliesEffect': {
                    // Identify the acting side's board
                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);
                    for (const [idx, u] of allies.entries()) {
                        if (u && u.card) {
                            // Recursively apply the nested effect to every unit on this board
                            await applyCardEffect(effect.effect, u, { ...context, slot: idx, board: allies });
                        }
                    }
                    break;
                }

                case 'giveAllEnemiesEffect': {
                    // Identify the opposing board
                    const enemies = getOpposingBoard(context);
                    const enemySide = (context.side === 'player' ? 'enemy' : 'player');
                    for (const [idx, u] of enemies.entries()) {
                        if (u && u.card) {
                            // Recursively apply the nested effect to every unit on the enemy board
                            await applyCardEffect(effect.effect, u, {
                                ...context,
                                target: u,
                                targetIdx: idx,
                                board: enemies,
                                side: enemySide,
                                opponentBoard: context.board
                            });
                        }
                    }
                    break;
                }

                case 'giveSpecificAllyEffect': {
                    // Apply a specific effect to a targeted ally
                    const targetType = effect.target || 'self'; // 'self' | 'random' | 'cardName'
                    const effectType = effect.effectType; // 'shield' | 'invincibility' | 'invisibility'
                    const effectValue = resolveEffectValue(effect.value ?? amount, card, context);

                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);
                    let targetUnit = null;
                    let targetIdx = null;

                    // Determine the target unit based on targetType
                    if (targetType === 'self') {
                        targetUnit = unit;
                        targetIdx = context.slot;
                    } else if (targetType === 'random') {
                        // Pick a random alive ally
                        const alive = allies.map((u, i) => u && u.card ? { u, i } : null).filter(Boolean);
                        if (alive.length > 0) {
                            const pick = alive[Math.floor(Math.random() * alive.length)];
                            targetUnit = pick.u;
                            targetIdx = pick.i;
                        }
                    } else if (targetType === 'cardName') {
                        // Find a specific ally by card name
                        const cardName = effect.cardName;
                        for (let i = 0; i < allies.length; i++) {
                            if (allies[i] && allies[i].card && allies[i].card.name === cardName) {
                                targetUnit = allies[i];
                                targetIdx = i;
                                break;
                            }
                        }
                    }

                    // Apply the effect if a target was found
                    if (targetUnit) {
                        targetUnit.status = targetUnit.status || {};

                        switch (effectType) {
                            case 'shield':
                                targetUnit.status.shield = (targetUnit.status.shield || 0) + effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} ${effectValue} SHIELD!`);
                                break;
                            case 'invincibility':
                                targetUnit.status.invincible = (targetUnit.status.invincible || 0) + effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} INVINCIBILITY FOR ${effectValue} ROUND(S)!`);
                                break;
                            case 'invisibility':
                                targetUnit.status.invisible = (targetUnit.status.invisible || 0) + effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} INVISIBILITY FOR ${effectValue} ROUND(S)!`);
                                break;
                            case 'reflect':
                                targetUnit.status.reflect = (targetUnit.status.reflect || 0) + effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} REFLECT ${effectValue}!`);
                                break;
                            case 'attackUp':
                                targetUnit.card.atk += effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} +${effectValue} ATTACK!`);
                                updateCardStats(context.side, targetIdx);
                                break;
                            case 'hpUp':
                                targetUnit.card.maxHp += effectValue;
                                targetUnit.card.hp += effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} +${effectValue} MAX HP!`);
                                updateCardStats(context.side, targetIdx);
                                break;
                            default:
                                console.warn(`Unknown effect type: ${effectType}`);
                        }

                        // Animate the buffed ally
                        const allyEl = getSlotCard(context.side, targetIdx);
                        if (allyEl) animateCard(allyEl, 'animate-ability');
                    } else {
                        log(`${card.name.toUpperCase()} TRIED TO BUFF AN ALLY BUT NO TARGET WAS FOUND.`);
                    }
                    break;
                }

                case 'nexusHpToPowerUp': {
                    const hpCost = amount; // The amount of Nexus HP to extract
                    const atkBonus = effect.atkGain || 0;
                    const hpBonus = effect.hpGain || 0;
                    // Default to the acting unit's own nexus if no explicit target is set
                    const targetNexus = effect.target || context.side || 'player';

                    // 1. Subtract the HP from the specified Nexus
                    if (targetNexus === 'player') {
                        state.pHp -= hpCost;
                        animateCard(document.getElementById('player-hp'), 'animate-ability');
                    } else {
                        state.eHp -= hpCost;
                        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    }

                    // 2. Apply the "Power Up" to the card itself
                    unit.card.atk += atkBonus;
                    unit.card.maxHp += hpBonus;
                    unit.card.hp += hpBonus;

                    log(`${card.name.toUpperCase()} EXTRACTED ${hpCost} HP FROM ${targetNexus.toUpperCase()} NEXUS FOR +${atkBonus}/+${hpBonus}.`);
                    
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                        updateCardStats(context.side, context.slot);
                    }
                    break;
                }
                
                case 'applyInvincible':
                        // Initialize status if it doesn't exist, then add rounds
                        unit.status.invincible = (unit.status.invincible || 0) + amount;
                        log(`${unit.card.name.toUpperCase()} is now INVINCIBLE for ${amount} rounds!`);
                        break;
                case 'curseAllEnemies': {
                    const cursedBoard = getOpposingBoard(context) || [];
                    const cursedSide = getBoardSide(cursedBoard);
                    for (let i = 0; i < cursedBoard.length; i++) {
                        const target = cursedBoard[i];
                        if (!target || !target.card) continue;

                        target.card.maxHp = Math.max(1, target.card.maxHp - amount);
                        target.card.hp = Math.min(target.card.hp, target.card.maxHp);
                        log(`${target.card.name.toUpperCase()} LOSES ${amount} MAX HP.`);

                        if (target.card.hp <= 0) {
                            await resolveBoardUnitDeath(target, cursedBoard, i);
                        } else {
                            updateCardStats(cursedSide, i);
                        }
                    }
                    break;
                }
                
                case 'reviveSelf':
                    // Check if a "once per game" flag exists, or just heal
                    if (!unit.status.wasRevived) {
                        unit.card.hp = amount;
                        unit.status.wasRevived = true;
                        log(`${card.name.toUpperCase()} REVIVED with ${amount} HP!`);
                        if (context.side !== undefined && context.slot !== undefined) {
                            animateCard(getSlotCard(context.side, context.slot), 'animate-heal');
                            updateCardStats(context.side, context.slot);
                        }
                    }
                    break;
                case "gainMana":
                    if (context.side === 'enemy') break; // Enemy has no mana pool
                    // 1. If the bonus 'amount' is already higher than our max cap, 
                    // we let it 'overflow' by setting mana directly to that amount.
                    if (amount > state.maxMana) {
                        state.mana = amount;
                    } else {
                        // 2. Otherwise, we add it normally but stay capped at maxMana.
                        state.mana = Math.min(state.maxMana, state.mana + amount);
                    }

                    log(`${card.name.toUpperCase()} RECOVERED ${amount} MANA (OVERFLOW ALLOWED).`);
                    break;
                case 'triggerDialogue':
                    // Pause the game and show the character talking
                    await speak(context.speaker || "Opponent", effect.text);
                    break;

                case 'stealAttack': {
                    // Drains ATK from context.target (the struck unit) and adds it to self.
                    const victim = context.target;
                    if (victim && victim.card && victim.card.atk > 0) {
                        const stolen = Math.min(amount, victim.card.atk);
                        victim.card.atk -= stolen;
                        unit.card.atk   += stolen;
                        log(`${card.name.toUpperCase()} STEALS ${stolen} ATK FROM ${victim.card.name.toUpperCase()}! (NOW ${unit.card.atk} ATK)`);
                        if (context.side !== undefined && context.slot !== undefined) {
                            animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                            updateCardStats(context.side, context.slot);
                        }
                        const stealOppSide = context.side === 'player' ? 'enemy' : 'player';
                        const stealOppBoard = stealOppSide === 'enemy' ? state.eBoard : state.pBoard;
                        const stealVictimIdx = stealOppBoard.indexOf(victim);
                        if (stealVictimIdx !== -1) updateCardStats(stealOppSide, stealVictimIdx);
                    }
                    break;
                }

                case 'stealAttackFromAll': {
                    // Drains ATK from every enemy and stacks it all onto self.
                    const stealBoard = getOpposingBoard(context);
                    const stealBoardSide = getBoardSide(stealBoard);
                    let totalStolen = 0;
                    stealBoard.forEach((u, i) => {
                        if (u && u.card && u.card.atk > 0) {
                            const stolen = Math.min(amount, u.card.atk);
                            u.card.atk  -= stolen;
                            totalStolen += stolen;
                            updateCardStats(stealBoardSide, i);
                        }
                    });
                    if (totalStolen > 0) {
                        unit.card.atk += totalStolen;
                        log(`${card.name.toUpperCase()} DRAINS ${totalStolen} ATK FROM ALL ENEMIES - NOW AT ${unit.card.atk} ATK.`);
                        if (context.side !== undefined && context.slot !== undefined) {
                            animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                            updateCardStats(context.side, context.slot);
                        }
                    }
                    break;
                }

                case 'silenceRandomEnemy': {
                    // Silences a single random enemy unit for 'amount' turns.
                    const silenceBoard = getOpposingBoard(context);
                    const silenceTargets = silenceBoard.map((u, i) => u ? i : -1).filter(i => i !== -1);
                    if (silenceTargets.length > 0) {
                        const silenceIdx = silenceTargets[Math.floor(Math.random() * silenceTargets.length)];
                        const silenceVictim = silenceBoard[silenceIdx];
                        if (!silenceVictim.status) silenceVictim.status = {};
                        silenceVictim.status.silenced = (silenceVictim.status.silenced || 0) + amount;
                        log(`${card.name.toUpperCase()} SILENCES ${silenceVictim.card.name.toUpperCase()} FOR ${amount} TURN(S).`);
                        const silenceSide = context.side === 'player' ? 'enemy' : 'player';
                        animateCard(getSlotCard(silenceSide, silenceIdx), 'animate-ability');
                    }
                    break;
                }

                case 'yandereRage': {
                    // On death, destroys a random enemy unit.
                    const rageBoard = getOpposingBoard(context);
                    const rageTargets = rageBoard.map((u, i) => u ? i : -1).filter(i => i !== -1);
                    if (rageTargets.length > 0) {
                        const rageIdx = rageTargets[Math.floor(Math.random() * rageTargets.length)];
                        const rageVictim = rageBoard[rageIdx];
                        log(`${card.name.toUpperCase()} - YANDERE RAGE! DRAGS ${rageVictim.card.name.toUpperCase()} DOWN WITH HER!`);
                        const rageSide = context.side === 'player' ? 'enemy' : 'player';
                        await triggerCardEvent('onDeath', rageVictim, { slot: rageIdx, side: rageSide, board: rageBoard });
                        const rageEl = getSlotCard(rageSide, rageIdx);
                        if (rageEl) animateCardDeath(rageEl, () => { rageBoard[rageIdx] = null; });
                        else rageBoard[rageIdx] = null;
                    }
                    break;
                }

                case 'rollStat': {
                    const tries  = effect.tries ?? 1;
                    const min    = effect.min   ?? 1;
                    const max    = effect.max   ?? 3;
                    const stat   = effect.stat  ?? 'atk';
                    const target = effect.target ?? 'self'; // 'self' | 'randomAlly' | 'allAllies'

                    const applyRoll = async (u, slotIdx) => {
                        let best = 0;
                        const rolls = [];
                        for (let r = 0; r < tries; r++) {
                            const roll = Math.floor(Math.random() * (max - min + 1)) + min;
                            rolls.push(roll);
                            if (roll > best) best = roll;
                        }

                        const el = getSlotCard(context.side, slotIdx);
                        await delay(100);
                        spawnRollPopup(el, rolls, best, stat);

                        if (stat === 'hp') {
                            u.card.maxHp += best;
                            u.card.hp    += best;
                            console.log(`${u.card.name.toUpperCase()} ROLLED [${rolls.join(', ')}] → BEST: +${best} MAX HP.`);
                            animateCard(getSlotCard(context.side, slotIdx), 'animate-heal');
                            updateCardStats(context.side, slotIdx);
                        } else {
                            u.card.atk += best;
                            console.log(`${u.card.name.toUpperCase()} ROLLED [${rolls.join(', ')}] → BEST: +${best} ATK.`);
                            animateCard(getSlotCard(context.side, slotIdx), 'animate-ability');
                            updateCardStats(context.side, slotIdx);
                        }
                    };

                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);

                    if (target === 'allAllies') {
                        const promises = allies.map((u, i) => u && u.card ? applyRoll(u, i) : Promise.resolve());
                        await Promise.all(promises);
                    } else if (target === 'randomAlly') {
                        const alive = allies.map((u, i) => u ? { u, i } : null).filter(Boolean);
                        if (alive.length > 0) {
                            const pick = alive[Math.floor(Math.random() * alive.length)];
                            await applyRoll(pick.u, pick.i);
                        }
                    } else {
                        // self (default)
                        await applyRoll(unit, context.slot);
                    }
                    break;
                }
                case 'removeEnemyAbility': {
                    const rTarget = effect.target ?? 'random';
                    const pool    = getOpposingBoard(context);

                    const strip = (u) => {
                        if (!u || !u.card) return;
                        const old = u.card.ability;
                        if (!old || old === 'none') return;
                        u.card.ability = 'none';
                        log(`${card.name.toUpperCase()} STRIPS [${old.toUpperCase()}] FROM ${u.card.name.toUpperCase()}!`);
                        const victimSide = context.side === 'player' ? 'enemy' : 'player';
                        const idx = pool.indexOf(u);
                        if (idx !== -1) animateCard(getSlotCard(victimSide, idx), 'animate-ability');
                    };

                    if (rTarget === 'all') {
                        pool.forEach(strip);
                    } else if (rTarget === 'highest') {
                        const candidate = pool
                            .filter(u => u && u.card)
                            .sort((a, b) => b.card.atk - a.card.atk)[0];
                        strip(candidate);
                    } else {
                        // random
                        const alive = pool.filter(u => u && u.card && u.card.ability && u.card.ability !== 'none');
                        if (alive.length > 0) strip(alive[Math.floor(Math.random() * alive.length)]);
                    }
                    break;
                }
                case 'energised': {
                    if (amount > 0) {
                        unit.status.energised = true;
                        log(`${card.name.toUpperCase()} IS ENERGISED — WILL ALWAYS STRIKE TWICE!`);
                        if (context.side !== undefined && context.slot !== undefined)
                            animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                }
                case 'manaDrain': {
                    if (context.side === 'player') break; // Only enemy cards should drain player mana
                    const drain = Math.min(amount, state.maxMana - 1); // never below 1
                    if (drain > 0) {
                        state.maxMana -= drain;
                        log(`${card.name.toUpperCase()} DRAINED ${drain} MANA FROM THE FIELD! MAX IS NOW ${state.maxMana}.`);
                        animateCard(document.getElementById('mana-text'), 'animate-ability');
                    }
                    break;
                }
                case 'manaSteal': {
                    if (context.side === 'player') break; // Only enemy cards should steal player mana
                    const stolen = Math.min(amount, state.maxMana - 1);
                    if (stolen > 0) {
                        state.maxMana -= stolen;
                        state.mana = Math.min(state.mana + stolen, state.maxMana + stolen);
                        log(`${card.name.toUpperCase()} STEALS ${stolen} MANA! POOL NOW ${state.maxMana}.`);
                        animateCard(document.getElementById('mana-text'), 'animate-ability');
                    }
                    break;
                }

                case 'giveSpecificCardBenefits': {
                    const targetCardName = effect.cardName;
                    if (!targetCardName) {
                        console.warn('giveSpecificCardBenefits: No cardName specified');
                        break;
                    }

                    const atkBonus = effect.atkBonus || 0;
                    const hpBonus = effect.hpBonus || 0;
                    const statusType = effect.statusType; // e.g., 'invincible'
                    const statusAmount = effect.statusAmount || 1;

                    // Search both boards for the specific card
                    const allBoards = [
                        { board: state.pBoard, side: 'player' },
                        { board: state.eBoard, side: 'enemy' }
                    ];

                    let found = false;
                    for (const { board, side } of allBoards) {
                        for (let idx = 0; idx < board.length; idx++) {
                            const unit = board[idx];
                            if (unit && unit.card && unit.card.name === targetCardName) {
                                // Apply benefits to the found card
                                if (atkBonus > 0) {
                                    unit.card.atk += atkBonus;
                                }
                                if (hpBonus > 0) {
                                    unit.card.maxHp += hpBonus;
                                    unit.card.hp += hpBonus;
                                }
                                if (statusType && statusAmount > 0) {
                                    unit.status = unit.status || {};
                                    unit.status[statusType] = (unit.status[statusType] || 0) + statusAmount;
                                }

                                log(`${card.name.toUpperCase()} BUFFS ${targetCardName.toUpperCase()} WITH +${atkBonus} ATK, +${hpBonus} HP${statusType ? `, AND ${statusAmount} ${statusType.toUpperCase()}` : ''}!`);
                                
                                // Animate the buffed card
                                const cardEl = getSlotCard(side, idx);
                                if (cardEl) animateCard(cardEl, 'animate-ability');
                                updateCardStats(side, idx);
                                
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }

                    if (!found) {
                        log(`${card.name.toUpperCase()} TRIED TO BUFF ${targetCardName.toUpperCase()} BUT IT'S NOT IN PLAY.`);
                    }
                    break;
                }

                case 'applyShield': {
                    // Give the unit a shield that absorbs damage
                    unit.status = unit.status || {};
                    unit.status.shield = (unit.status.shield || 0) + amount;
                    log(`${card.name.toUpperCase()} GAINS ${amount} SHIELD!`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                }

                case 'applyReflect': {
                    // Give the unit reflect that damages attackers
                    unit.status = unit.status || {};
                    unit.status.reflect = (unit.status.reflect || 0) + amount;
                    log(`${card.name.toUpperCase()} GAINS REFLECT ${amount}! ATTACKERS WILL TAKE DAMAGE.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                }

                case 'applyInvisibility': {
                    // Make the unit invisible (can't be targeted)
                    unit.status = unit.status || {};
                    unit.status.invisible = (unit.status.invisible || 0) + amount;
                    log(`${card.name.toUpperCase()} BECOMES INVISIBLE FOR ${amount} ROUND(S)! CAN'T BE TARGETED.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                }

                case 'lowerRandomEnemysAttack': {
                    // Lowers ATK from a random enemy.
                    const enemyBoard = getOpposingBoard(context) || [];
                    const candidates = enemyBoard
                        .map((target, idx) => target && target.card ? { target, idx } : null)
                        .filter(Boolean);

                    if (candidates.length === 0) break;

                    const victimPick = candidates[Math.floor(Math.random() * candidates.length)];
                    const victim = victimPick.target;
                    const lowered = Math.min(amount, victim.card.atk);
                    victim.card.atk -= lowered;
                    log(`${card.name.toUpperCase()} LOWERS ${victim.card.name.toUpperCase()}'S ATTACK BY ${lowered}! (NOW ${victim.card.atk} ATK)`);
                    updateCardStats(getBoardSide(enemyBoard), victimPick.idx);
                    break;
                }

                case 'lowerSpecificEnemysAttack': {
                    // Lowers ATK from the specific targeted enemy.
                    if (context.target && context.target.card) {
                        const lowered = Math.min(amount, context.target.card.atk);
                        context.target.card.atk -= lowered;
                        log(`${card.name.toUpperCase()} LOWERS ${context.target.card.name.toUpperCase()}'S ATTACK BY ${lowered}! (NOW ${context.target.card.atk} ATK)`);
                        const specOppSide = context.side === 'player' ? 'enemy' : 'player';
                        const specOppBoard = specOppSide === 'enemy' ? state.eBoard : state.pBoard;
                        const specIdx = specOppBoard.indexOf(context.target);
                        if (specIdx !== -1) updateCardStats(specOppSide, specIdx);
                    }
                    break;
                }

                case 'lowerAllEnemiesAttack': {
                    // Lowers ATK from all enemies.
                    const enemyBoard = getOpposingBoard(context) || [];
                    const lowerAllSide = getBoardSide(enemyBoard);
                    let totalLowered = 0;
                    for (let i = 0; i < enemyBoard.length; i++) {
                        const target = enemyBoard[i];
                        if (target && target.card && target.card.atk > 0) {
                            const lowered = Math.min(amount, target.card.atk);
                            target.card.atk -= lowered;
                            totalLowered += lowered;
                            log(`${target.card.name.toUpperCase()}'S ATTACK LOWERED BY ${lowered}! (NOW ${target.card.atk} ATK)`);
                            updateCardStats(lowerAllSide, i);
                        }
                    }
                    if (totalLowered > 0) {
                        log(`${card.name.toUpperCase()} LOWERED ALL ENEMIES' ATTACK BY A TOTAL OF ${totalLowered}!`);
                    }
                    break;
                }

                case 'powerExchange': {
                    // Swap attack values between self and a random enemy.
                    const enemyBoard = getOpposingBoard(context) || [];
                    const candidates = enemyBoard
                        .map((target, idx) => target && target.card ? { target, idx } : null)
                        .filter(Boolean);

                    if (candidates.length === 0) break;

                    const victimPick = candidates[Math.floor(Math.random() * candidates.length)];
                    const victim = victimPick.target;
                    const selfAtk = unit.card.atk;
                    const victimAtk = victim.card.atk;
                    
                    unit.card.atk = victimAtk;
                    victim.card.atk = selfAtk;
                    
                    log(`${card.name.toUpperCase()} EXCHANGES POWER WITH ${victim.card.name.toUpperCase()}! ${card.name.toUpperCase()} NOW HAS ${unit.card.atk} ATK, ${victim.card.name.toUpperCase()} NOW HAS ${victim.card.atk} ATK!`);
                    if (context.side !== undefined && context.slot !== undefined) updateCardStats(context.side, context.slot);
                    const exchOppSide = context.side === 'player' ? 'enemy' : 'player';
                    const exchOppBoard = exchOppSide === 'enemy' ? state.eBoard : state.pBoard;
                    const exchVictimIdx = exchOppBoard.indexOf(victim);
                    if (exchVictimIdx !== -1) updateCardStats(exchOppSide, exchVictimIdx);
                    break;
                }

                case 'multiStrike': {
                    // Attack a random enemy 3 times (can hit different targets).
                    const enemyBoard = getOpposingBoard(context) || [];
                    let totalDamage = 0;
                    const strikeCount = 3;

                    for (let strike = 0; strike < strikeCount; strike++) {
                        const candidates = enemyBoard
                            .map((target, idx) => target && target.card ? { target, idx } : null)
                            .filter(Boolean);

                        if (candidates.length === 0) break;

                        const victimPick = candidates[Math.floor(Math.random() * candidates.length)];
                        const victim = victimPick.target;
                        victim.card.hp -= amount;
                        totalDamage += amount;
                        
                        log(`${card.name.toUpperCase()} STRIKE ${strike + 1}/3 - HITS ${victim.card.name.toUpperCase()} FOR ${amount} DAMAGE!`);

                        if (victim.card.hp <= 0) {
                            log(`${victim.card.name.toUpperCase()} DIES.`);
                            await resolveBoardUnitDeath(victim, enemyBoard, victimPick.idx);
                        } else {
                            updateCardStats(getBoardSide(enemyBoard), victimPick.idx);
                        }
                    }
                    log(`${card.name.toUpperCase()} COMPLETED MULTI-STRIKE, DEALING ${totalDamage} TOTAL DAMAGE!`);
                    break;
                }

                case 'drainHealthFromAll': {
                    // Steal HP from all enemies and heal self.
                    const enemyBoard = getOpposingBoard(context) || [];
                    const drainSide = getBoardSide(enemyBoard);
                    let totalDrained = 0;

                    for (let i = 0; i < enemyBoard.length; i++) {
                        const target = enemyBoard[i];
                        if (target && target.card && target.card.hp > 0) {
                            const drained = Math.min(amount, target.card.hp);
                            target.card.hp -= drained;
                            totalDrained += drained;
                            log(`${target.card.name.toUpperCase()} LOSES ${drained} HP!`);

                            if (target.card.hp <= 0) {
                                await triggerCardEvent('onDeath', target, { slot: i, side: enemyBoard === state.eBoard ? 'enemy' : 'player', board: enemyBoard });
                                if (enemyBoard[i] === target && target.card.hp <= 0) {
                                    enemyBoard[i] = null;
                                }
                            } else {
                                updateCardStats(drainSide, i);
                            }
                        }
                    }

                    if (totalDrained > 0) {
                        const healed = Math.min(unit.card.maxHp - unit.card.hp, totalDrained);
                        unit.card.hp += healed;
                        log(`${card.name.toUpperCase()} DRAINS ${totalDrained} HP FROM ALL ENEMIES AND HEALS FOR ${healed} HP! (NOW ${unit.card.hp} HP)`);
                        if (context.side !== undefined && context.slot !== undefined) updateCardStats(context.side, context.slot);
                    }
                    break;
                }
                case 'damageNexus': {
                    // Damage the opposite nexus for the specified amount
                    const target = effect.target || (context.side === 'player' ? 'enemy' : 'player');
                    if (target === 'enemy') {
                        state.eHp -= amount;
                        log(`${card.name.toUpperCase()} DEALS ${amount} DAMAGE TO ENEMY NEXUS!`);
                        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                        spawnDamagePopup(document.getElementById('enemy-hp'), `-${amount}`, 'dmg');
                        shakeArena(true);
                    } else {
                        state.pHp -= amount;
                        log(`${card.name.toUpperCase()} DEALS ${amount} DAMAGE TO YOUR NEXUS!`);
                        animateCard(document.getElementById('player-hp'), 'animate-ability');
                        spawnDamagePopup(document.getElementById('player-hp'), `-${amount}`, 'dmg');
                    }
                    break;
                }

                case 'nexusSwapHp': {
                    // Swap the HP of both nexuses - Witch Mother Kirsti ultimate ability
                    const cardEl = context.side ? getSlotCard(context.side, context.slot) : null;
                    const pHpBefore = state.pHp;
                    const eHpBefore = state.eHp;
                    
                    state.pHp = eHpBefore;
                    state.eHp = pHpBefore;
                    
                    log(`${card.name.toUpperCase()} — NEXUS SWAP! Your HP: ${pHpBefore} → ${state.pHp} | Enemy HP: ${eHpBefore} → ${state.eHp}!`);
                    
                    // Epic visual effects
                    if (cardEl) {
                        spawnFireParticles(cardEl, 20);
                        flashScreen();
                        flashVignette('purple');
                        spawnLightningArc(cardEl, document.getElementById('player-hp') || document.body, '#9333ea');
                        spawnLightningArc(cardEl, document.getElementById('enemy-hp') || document.body, '#9333ea');
                    }
                    
                    animateCard(document.getElementById('player-hp'), 'animate-ability');
                    animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    shakeArena(true);
                    break;
                }

                case 'damageNexusPerAttackLowered': {
                    // Apex Arachnea Kirsti: For every attack point lowered from enemies, deal damage to enemy nexus
                    const cardEl = context.side ? getSlotCard(context.side, context.slot) : null;
                    const attackValue = effect.attackValue || unit.card.atk;
                    const enemyBoard = getOpposingBoard(context);
                    const dnaBlSide = getBoardSide(enemyBoard);
                    let totalLowered = 0;
                    
                    enemyBoard.forEach((u, i) => {
                        if (u && u.card && u.card.atk > 0) {
                            const lowered = Math.min(attackValue, u.card.atk);
                            u.card.atk -= lowered;
                            totalLowered += lowered;
                            updateCardStats(dnaBlSide, i);
                        }
                    });
                    
                    if (totalLowered > 0) {
                        if (context.side === 'player') {
                            state.eHp -= totalLowered;
                            log(`${card.name.toUpperCase()} — APEX ARACHNEA: Lowered ${totalLowered} ATK, dealing ${totalLowered} to enemy Nexus!`);
                            animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                            spawnDamagePopup(document.getElementById('enemy-hp'), `-${totalLowered}`, 'dmg');
                            shakeArena(true);
                        } else {
                            state.pHp -= totalLowered;
                            log(`${card.name.toUpperCase()} — APEX ARACHNEA: Lowered ${totalLowered} ATK, dealing ${totalLowered} to your Nexus!`);
                            animateCard(document.getElementById('player-hp'), 'animate-ability');
                            spawnDamagePopup(document.getElementById('player-hp'), `-${totalLowered}`, 'dmg');
                        }
                        
                        // Visual: purple lightning arcs to all affected enemies then to nexus
                        if (cardEl) {
                            spawnLightningArc(cardEl, document.getElementById(context.side === 'player' ? 'enemy-hp' : 'player-hp'), '#9333ea');
                            spawnFireParticles(cardEl, 15);
                            flashVignette('purple');
                        }
                    }
                    break;
                }

                case 'summonRandom': {
                    // Summon a random card from a provided list
                    const cardList = effect.cardNames || effect.cards || [];
                    if (!Array.isArray(cardList) || cardList.length === 0) {
                        console.warn('summonRandom: No card list provided');
                        break;
                    }

                    // Pick a random card name from the list
                    const randomCardName = cardList[Math.floor(Math.random() * cardList.length)];
                    const summonTemplate = ALL_CHARS.find(c => c.name === randomCardName);

                    if (summonTemplate) {
                        // Use the board provided in context (passed from await triggerCardEvent)
                        // If no board in context, default to player board
                        const targetBoard = context.board || state.pBoard;
                        const sideName = (targetBoard === state.pBoard) ? "PLAYER" : "ENEMY";

                        let count = 0;
                        const summonQty = resolveEffectValue(effect.amount || 1, card, context);
                        
                        for (let i = 0; i < summonQty; i++) {
                            const emptyIdx = targetBoard.findIndex(slot => slot === null);
                            if (emptyIdx !== -1) {
                                targetBoard[emptyIdx] = { 
                                    card: cloneCard(summonTemplate),
                                    status: { exhausted: true, justPlayed: true, silenced: false } 
                                };
                                await triggerCardEvent('onPlay', targetBoard[emptyIdx], {
                                    slot: emptyIdx,
                                    side: getBoardSide(targetBoard),
                                    board: targetBoard
                                });
                                count++;
                            }
                        }
                        if (count > 0) {
                            log(`${card.name.toUpperCase()} SUMMONED ${count} ${randomCardName.toUpperCase()}(S) TO ${sideName} BOARD.`);
                        }
                    } else {
                        console.warn(`Card to summon not found: ${randomCardName}`);
                    }
                    break;
                }
                case 'atkUpAllAllies': {
                    // NEW: Increases ATK for every unit on the acting unit's board
                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);
                    
                    allies.forEach((u, idx) => {
                        if (u && u.card) {
                            u.card.atk += amount;
                            log(`${u.card.name.toUpperCase()} GAINS +${amount} ATK.`);
                            
                            // Animate each ally receiving the buff
                            const allyEl = getSlotCard(context.side, idx);
                            if (allyEl) animateCard(allyEl, 'animate-ability');
                        }
                    });
                    break;
                }

                case 'restoreMchanSlots': {
                    const restored = unit.status?.mchanSlotsRemoved || 0;
                    const oppSide  = unit.status?.mchanOppSide || (context.side === 'player' ? 'enemy' : 'player');
                    if (restored > 0) {
                        log(`M-CHAN DIES — ${oppSide.toUpperCase()} BOARD RESTORED BY ${restored} SLOT(S).`);
                        if (oppSide === 'enemy') {
                            state.eBoard = [...state.eBoard, ...Array(restored).fill(null)];
                        } else {
                            state.pBoard = [...state.pBoard, ...Array(restored).fill(null)];
                        }
                        setBoardSize(state.pBoard.length, state.eBoard.length);
                    }
                    // Remove ice aura from M-chan's card element if still in DOM
                    if (context.slot !== undefined) {
                        const mchanEl = getSlotCard(context.side, context.slot);
                        if (mchanEl) mchanEl.classList.remove('mchan-active');
                    }
                    break;
                }

        }
    }
        async function enemySpeak(text, duration = 2000) {
        triggerDialogue("Rival Duelist", text); // Call your existing VN dialogue box
        await delay(duration); // Wait for the text to type out and linger
    }

        // ═══════════════════════════════════════════════════════════════════════
        // LEGENDARY PASSIVE SYSTEM
        // Each legendary card has a unique passive that fires on every game event.
        // These are coded in JS (not JSON) because they can read full board state,
        // react to other units' events, and use logic too complex for data-driven effects.
        // Rules:
        //   - Passives fire AFTER the triggering unit's own abilities resolve.
        //   - Silenced legendaries lose their passive for the duration.
        //   - dyingUnit in context = the unit whose event triggered this sweep
        //     (used by passives that react to allies dying, being attacked, etc.)
        // ═══════════════════════════════════════════════════════════════════════

        const LEGENDARY_PASSIVES = {

            // ── Diana Bullen (New Haven) ────────────────────────────────────────
            // COMPOUND FORMULA: When Diana kills an enemy, she draws 1 card and
            // all allies gain +1 ATK for the rest of the turn. Every destruction
            // is data. Every death is a formula she's already solved.
            'Diana Bullen': async function(unit, eventName, context) {
                if (eventName !== 'onDeath') return;
                const dyingUnit = context.dyingUnit;
                if (!dyingUnit || dyingUnit === unit) return;
                // Only fires if Diana was the one who killed them (attacker context)
                if (context.killedBy !== unit) return;
                draw();
                log(`DIANA BULLEN — COMPOUND FORMULA: Kill confirmed. Drawing 1 card and triggering dimensional reaction!`);
                const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                board.forEach((slot, idx) => {
                    if (!slot || !slot.card) return;
                    slot.card.atk += 1;
                    const el = getSlotCard(context.side, idx);
                    if (el) { spawnAbilityRing(el, 'buff'); animateCard(el, 'animate-ability'); }
                    updateCardStats(context.side, idx);
                });
                log(`DIANA BULLEN — COMPOUND FORMULA: All allies +1 ATK from the reaction!`);
            },

            // ── Marija (New Haven) ──────────────────────────────────────────────
            // IRON DIRECTOR: Whenever an ally dies, Marija refuses to be shaken.
            // She permanently gains +1 ATK and heals herself for 2 HP.
            // Grief becomes fuel. Loss becomes command.
            'Marija': async function(unit, eventName, context) {
                if (eventName !== 'onDeath') return;
                const dyingUnit = context.dyingUnit;
                if (!dyingUnit || dyingUnit === unit) return;
                unit.card.atk += 1;
                unit.card.hp = Math.min(unit.card.maxHp, unit.card.hp + 2);
                log(`MARIJA — IRON DIRECTOR: ${dyingUnit.card.name.toUpperCase()} falls. Marija grows colder. (+1 ATK, +2 HP | Now ${unit.card.atk} ATK, ${unit.card.hp} HP)`);
                const el = getSlotCard(context.side, context.slot);
                if (el) { spawnAbilityRing(el, 'buff'); spawnHealRipple(el); }
                updateCardStats(context.side, context.slot);
            },

            // ── Maria Hunley (Adoptive Life) ────────────────────────────────────
            // NO CHILD LEFT BEHIND: Whenever any ally drops to 3 HP or below,
            // Maria immediately heals that ally for 3 HP. She always senses
            // when one of hers needs her. Once per turn per ally.
            'Maria Hunley': async function(unit, eventName, context) {
                if (eventName !== 'whenAttacked') return;
                const attackedUnit = context.dyingUnit;
                if (!attackedUnit || attackedUnit === unit) return;
                if (attackedUnit.card.hp > 3) return; // Only triggers at 3 HP or below
                // Track who was already saved this turn to avoid repeat healing
                unit.status = unit.status || {};
                unit.status._mariaHealedThisTurn = unit.status._mariaHealedThisTurn || new Set();
                const uid = attackedUnit.card.name;
                if (unit.status._mariaHealedThisTurn.has(uid)) return;
                unit.status._mariaHealedThisTurn.add(uid);
                const healed = Math.min(attackedUnit.card.maxHp, attackedUnit.card.hp + 3) - attackedUnit.card.hp;
                if (healed > 0) {
                    attackedUnit.card.hp += healed;
                    log(`MARIA HUNLEY — NO CHILD LEFT BEHIND: Rushes to ${attackedUnit.card.name.toUpperCase()}! (+${healed} HP — now ${attackedUnit.card.hp} HP)`);
                    const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                    const idx = board.indexOf(attackedUnit);
                    if (idx !== -1) {
                        const allyEl = getSlotCard(context.side, idx);
                        if (allyEl) { spawnHealRipple(allyEl); animateCard(allyEl, 'animate-heal'); }
                        updateCardStats(context.side, idx);
                    }
                    const mariaEl = getSlotCard(context.side, context.slot);
                    if (mariaEl) spawnAbilityRing(mariaEl, 'heal');
                }
            },

            // ── Hayley (Adoptive Life) ──────────────────────────────────────────
            // INFINITE ENERGY: Every time Hayley heals any unit or the Nexus
            // (from any trigger she fires), she permanently gains +1 ATK.
            // She doesn't run out. She just gets more. There is no cap.
            'Hayley': async function(unit, eventName, context) {
                if (eventName !== 'onPlay' && eventName !== 'onTurnStart' && eventName !== 'onTurnEnd') return;
                // Count heal effects that Hayley has in this event
                const healsInEvent = (unit.card.abilities?.[eventName] || []).filter(e =>
                    e.type === 'healNexus' || e.type === 'healAllies' || e.type === 'healSelf'
                ).length;
                if (healsInEvent === 0) return;
                unit.card.atk += healsInEvent;
                log(`HAYLEY — INFINITE ENERGY: Healed ${healsInEvent} time(s) this trigger! +${healsInEvent} ATK permanently. (Now ${unit.card.atk} ATK)`);
                const el = getSlotCard(context.side, context.slot);
                if (el) { spawnAbilityRing(el, 'buff'); animateCard(el, 'animate-ability'); }
                updateCardStats(context.side, context.slot);
            },

            // ── Helga (Atarashī gakkō; Secret Garden!) ─────────────────────────
            // RULE OF SILENCE: At the start of each turn, Helga strips 1 ATK
            // from the highest-ATK enemy. While alive, enemies cannot gain ATK
            // buffs — her authority erodes what it cannot control.
            'Helga': async function(unit, eventName, context) {
                if (eventName === 'onTurnStart') {
                    // Strip 1 ATK from highest-ATK enemy
                    const oppBoard = context.side === 'enemy' ? state.pBoard : state.eBoard;
                    const oppSide  = context.side === 'enemy' ? 'player' : 'enemy';
                    const candidates = oppBoard.map((s, i) => s && s.card ? { s, i } : null).filter(Boolean);
                    if (candidates.length === 0) return;
                    const { s: target, i: idx } = candidates.reduce(
                        (best, cur) => cur.s.card.atk > best.s.card.atk ? cur : best,
                        candidates[0]
                    );
                    if (target.card.atk > 0) {
                        target.card.atk = Math.max(0, target.card.atk - 1);
                        log(`HELGA — RULE OF SILENCE: Strips 1 ATK from ${target.card.name.toUpperCase()}. (Now ${target.card.atk} ATK)`);
                        const el = getSlotCard(oppSide, idx);
                        if (el) spawnSilenceOverlay(el);
                        updateCardStats(oppSide, idx);
                    }
                }
                // The ATK-buff suppression is handled by the existing silenceRandomEnemy
                // and curseAllEnemies on play — this passive covers the per-turn strip.
            },

            // ── Hina (Original) ─────────────────────────────────────────────────
            // SOUL CHARM: Every time Hina attacks, the target is Charmed —
            // silenced for 1 turn AND marked so it cannot deal damage to Hina
            // specifically for that turn. No soul resists her. She never asked for it.
            'Hina': async function(unit, eventName, context) {
                if (eventName !== 'onAttack') return;
                const target = context.target;
                if (!target || !target.card) return;
                target.status = target.status || {};
                // Silence 1 turn (charm)
                target.status.silenced = (target.status.silenced || 0) + 1;
                // Mark as charmed — prevents them attacking Hina (checked in combat logic)
                target.status.charmedBy = unit.card.name;
                log(`HINA — SOUL CHARM: ${target.card.name.toUpperCase()} is CHARMED! Silenced and cannot strike Hina this turn.`);
                const oppBoard = context.side === 'player' ? state.eBoard : state.pBoard;
                const oppSide  = context.side === 'player' ? 'enemy' : 'player';
                const idx = oppBoard.indexOf(target);
                if (idx !== -1) {
                    const el = getSlotCard(oppSide, idx);
                    if (el) { spawnSilenceOverlay(el); spawnAbilityRing(el, 'curse'); }
                }
            },

            // ── Saya (Original) ─────────────────────────────────────────────────
            // THREAT ASSESSMENT: At the start of every turn, Saya's AI auto-scans
            // the battlefield and silences the highest-ATK enemy for 1 turn.
            // She already calculated every outcome. She was never going to let them move first.
            'Saya': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                const oppBoard = context.side === 'player' ? state.eBoard : state.pBoard;
                const oppSide  = context.side === 'player' ? 'enemy' : 'player';
                const candidates = oppBoard.map((s, i) => s && s.card ? { s, i } : null).filter(Boolean);
                if (candidates.length === 0) return;
                const { s: target, i: idx } = candidates.reduce(
                    (best, cur) => cur.s.card.atk > best.s.card.atk ? cur : best,
                    candidates[0]
                );
                target.status = target.status || {};
                target.status.silenced = (target.status.silenced || 0) + 1;
                log(`SAYA — THREAT ASSESSMENT: ${target.card.name.toUpperCase()} identified as primary threat. Silenced.`);
                const el = getSlotCard(oppSide, idx);
                if (el) { spawnSilenceOverlay(el); spawnAbilityRing(el, 'silence'); }
            },

            // ── Daphne (Legend Of You) ──────────────────────────────────────────
            // EXTINCTION PROTOCOL: At the end of each turn, Daphne gains +1 ATK
            // and deals 1 direct damage to the enemy Nexus. She doesn't need to
            // win fights. She just needs to wait. The annihilation was scheduled.
            'Daphne': async function(unit, eventName, context) {
                if (eventName !== 'onTurnEnd') return;
                unit.card.atk += 1;
                // Deal 1 direct Nexus damage to the opponent
                if (context.side === 'player') {
                    state.eHp -= 1;
                    log(`DAPHNE — EXTINCTION PROTOCOL: +1 ATK. Deals 1 direct damage to enemy Nexus. (Enemy Nexus: ${state.eHp} HP)`);
                    animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                } else {
                    state.pHp -= 1;
                    log(`DAPHNE — EXTINCTION PROTOCOL: +1 ATK. Deals 1 direct damage to your Nexus. (Your Nexus: ${state.pHp} HP)`);
                    animateCard(document.getElementById('player-hp'), 'animate-ability');
                }
                const el = getSlotCard(context.side, context.slot);
                if (el) { spawnFireParticles(el, 6); animateCard(el, 'animate-ability'); }
                updateCardStats(context.side, context.slot);
            },

            // ── Shogun Kagetora (Bloodlines) ────────────────────────────────────
            // WARRIOR'S FORMATION: Whenever any ally attacks while Kagetora is on
            // the board, that ally permanently gains +1 ATK. He trains them in the
            // moment. Every strike made in his presence is sharper than the last.
            'Shogun Kagetora': async function(unit, eventName, context) {
                if (eventName !== 'onAttack') return;
                const attackingUnit = context.dyingUnit; // dyingUnit = the unit whose event fired
                if (!attackingUnit || attackingUnit === unit) return;
                attackingUnit.card.atk += 1;
                log(`SHOGUN KAGETORA — WARRIOR'S FORMATION: ${attackingUnit.card.name.toUpperCase()} trained in battle! (+1 ATK | Now ${attackingUnit.card.atk} ATK)`);
                const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                const idx = board.indexOf(attackingUnit);
                if (idx !== -1) {
                    const el = getSlotCard(context.side, idx);
                    if (el) { spawnAbilityRing(el, 'buff'); animateCard(el, 'animate-ability'); }
                    updateCardStats(context.side, idx);
                }
            },

            // ── Princess Beatrice (Dumb Super Fantasy RPG) ──────────────────────
            // ESSENTIA SURGE: While Beatrice is alive, both CEDERE and FERMO on
            // the board gain +1 ATK at the start of each turn — she empowers her
            // Avalistos with her living presence. (Unchanged — already perfect.)
            'Princess Beatrice': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                let buffed = 0;
                board.forEach((slot, idx) => {
                    if (!slot || !slot.card) return;
                    if (slot.card.name === 'CEDERE' || slot.card.name === 'FERMO') {
                        slot.card.atk += 1;
                        buffed++;
                        const el = getSlotCard(context.side, idx);
                        if (el) spawnAbilityRing(el, 'buff');
                        updateCardStats(context.side, idx);
                    }
                });
                if (buffed > 0) log(`PRINCESS BEATRICE — ESSENTIA SURGE: Empowers ${buffed} Avalistos with +1 ATK!`);
            },

            // ── Witch Morganarlisa (Medieval Adventure Novel) ───────────────────
            // ROTTING CURSE: At the end of each turn, every enemy on the board
            // loses 1 HP (this cannot kill). She makes them tender. She doesn't
            // need to eat them immediately. She just needs them ready.
            'Witch Morganarlisa': async function(unit, eventName, context) {
                if (eventName !== 'onTurnEnd') return;
                const oppBoard = context.side === 'enemy' ? state.pBoard : state.eBoard;
                const oppSide  = context.side === 'enemy' ? 'player' : 'enemy';
                let cursed = 0;
                oppBoard.forEach((slot, idx) => {
                    if (!slot || !slot.card) return;
                    if (slot.card.hp > 1) { // Cannot kill — minimum 1 HP
                        slot.card.hp -= 1;
                        cursed++;
                        const el = getSlotCard(oppSide, idx);
                        if (el) spawnAbilityRing(el, 'curse');
                        updateCardStats(oppSide, idx);
                    }
                });
                if (cursed > 0) log(`WITCH MORGANARLISA — ROTTING CURSE: Dark magic seeps into ${cursed} enemy/enemies. (-1 HP each)`);
            },

            // ── Anna Vinelace (Noble One) ───────────────────────────────────────
            // OPEN HAND: Whenever Anna triggers a buff or heal for an ally
            // (onPlay or onTurnStart effects that helped others), she draws 1 card.
            // Her generosity is infectious and always returns to her.
            'Anna Vinelace': async function(unit, eventName, context) {
                if (eventName !== 'onPlay' && eventName !== 'onTurnStart') return;
                const buffHealsInEvent = (unit.card.abilities?.[eventName] || []).filter(e =>
                    e.type === 'atkUpAllAllies' || e.type === 'giveAllAlliesEffect' ||
                    e.type === 'healAllies' || e.type === 'healSelf'
                ).length;
                if (buffHealsInEvent === 0) return;
                if (context.side !== 'enemy') draw();
                log(`ANNA VINELACE — OPEN HAND: Generosity returns — draws 1 card.`);
                const el = getSlotCard(context.side, context.slot);
                if (el) { spawnManaSparkles(el, 8); animateCard(el, 'animate-ability'); }
            },

            // ── Amy Lyn (Everythin' with Amy Lyn) ──────────────────────────────
            // STAR POWER: At the start of each turn, Amy Lyn gains +1 ATK and
            // +1 Max HP for every Amy Lyn variant on the board with her —
            // the more of herself there are, the stronger she becomes. (Unchanged.)
            'Amy Lyn': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                const variants = board.filter(slot =>
                    slot && slot.card &&
                    slot !== unit &&
                    slot.card.series === "Everythin' with Amy Lyn"
                ).length;
                if (variants === 0) return;
                unit.card.atk += variants;
                unit.card.maxHp += variants;
                unit.card.hp = Math.min(unit.card.hp + variants, unit.card.maxHp);
                log(`AMY LYN — STAR POWER: +${variants} ATK & +${variants} Max HP from ${variants} variant(s)!`);
                const el = getSlotCard(context.side, context.slot);
                if (el) { spawnAbilityRing(el, 'buff'); spawnHealRipple(el); }
                updateCardStats(context.side, context.slot);
            },

            // ── Kumi (Original) ─────────────────────────────────────────────────
            // DIVINE RESTRAINT: While Kumi is silenced, she becomes untargetable.
            // Enemies cannot choose to attack her and she cannot be the target of
            // abilities. Her silence is not weakness. It is the deepest protection.
            'Kumi': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart' && eventName !== 'onTurnEnd') return;
                unit.status = unit.status || {};
                const isSilenced = (unit.status.silenced || 0) > 0;
                if (isSilenced) {
                    // Grant untargetable (reuse invisible status — already blocks targeting)
                    unit.status.invisible = Math.max(unit.status.invisible || 0, 1);
                    log(`KUMI — DIVINE RESTRAINT: Silenced and resting — becomes untargetable. Her stillness is sacred.`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) el.classList.add('is-invisible-state');
                } else {
                    // When no longer silenced, remove the untargetable flag if it was set by this passive
                    // (only remove if HP is positive — she's back)
                    if ((unit.status.invisible || 0) > 0) {
                        unit.status.invisible = 0;
                        const el = getSlotCard(context.side, context.slot);
                        if (el) el.classList.remove('is-invisible-state');
                        log(`KUMI — DIVINE RESTRAINT: Silence lifted — Kumi returns to the field.`);
                    }
                }
            },

            // ═══════════════════════════════════════════════════════════════════════
            // KIRSTI — THE SHAPESHIFTER LEGENDARY
            // Kirsti is a shapeshifter that evolves based on how long she survives:
            // • Kitty Date Kirsti: 1/1 Haste, On Death: Adds Kirsti to hand (4-cost)
            // • Clever Kitsune Kirsti: 1/1 Echo, On Play: +2 Max HP to all allies
            // • Queen Bee Kirsti: 2/3 Guard, Counter Attacks, +1 ATK to all allies
            // • Matriarch Hyena Kirsti: 4/2 Berserk, On Hit: Draw 2, On Death: Spawn Kitty Date Kirsti
            // • Apex Arachnea Kirsti: 5/5, Lowers enemy ATK by self, deals to Nexus per point
            // • Abyssal Priestress Kirsti: 6/6 Guard, Invincible to counters, ignores Guard 2 turns
            // • Witch Mother Kirsti: 10/10, Swaps Nexus HP with enemy Nexus
            // • Post Mortem Kirsti: 5/1 Echo, On Turn Start: Enemy Nexus -4 HP, all allies +4 Max HP
            // ═══════════════════════════════════════════════════════════════════════

            // Get turns alive for Kirsti unit
            getKirstiTurnsAlive: function(unit) {
                return unit.status?.kirstiTurnsAlive || 0;
            },

            // Sets up Kirsti on the board — called when any Kirsti variant is played
            setupKirstiUnit: function(unit, context) {
                unit.status = unit.status || {};
                unit.status.kirstiTurnsAlive = 0;
                unit.status.kirstiVariant = 'Kitty Date Kirsti';
                log(`KIRSTI — Shape-shifting begins: Kitty Date Kirsti appears. (1 turn)`);
                const el = getSlotCard(context.side, context.slot);
                if (el) {
                    el.classList.add('kirsti-kitty');
                    setTimeout(() => el.classList.remove('kirsti-kitty'), 1500);
                }
            },

            // Kirsti on turn start — increment counter and check for evolution
            'Kirsti - Kitty Date Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Evolution at turn 1 → Clever Kitsune Kirsti
                if (turns === 1 && unit.card.name === 'Kirsti') {
                    // Evolve into Clever Kitsune Kirsti
                    const oldAtk = unit.card.atk;
                    const oldHp = unit.card.hp;
                    const oldMaxHp = unit.card.maxHp;
                    
                    unit.card.name = 'Clever Kitsune Kirsti';
                    unit.card.image = getCardImage('Clever Kitsune Kirsti');
                    unit.card.atk = 1;
                    unit.card.hp = 1;
                    unit.card.maxHp = 1;
                    unit.card.cost = 0;
                    unit.card.description = '**Echo.** On Play: All allies gain **+2 Max HP.**\n£{She shed her mortal skin and slipped into something wilder.}£';
                    unit.status.kirstiVariant = 'Clever Kitsune Kirsti';
                    unit.card.abilities = {
                        onPlay: [
                            { type: 'giveAllAlliesEffect', effect: { type: 'hpUpSelf', value: 2 } }
                        ],
                        onDeath: [
                            { type: 'spawnCard', cardName: 'Kirsti', amount: 1 }
                        ]
                    };
                    
                    log(`KIRSTI — KITTY DATE EVOLVES → CLEVER KITSUNE KIRSTI! (1/1 → 1/1 | +2 Max HP to all on play)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-kitsune');
                        el.querySelector('.card-name')?.remove();
                        spawnAbilityRing(el, 'heal');
                        animateCard(el, 'animate-legendary-transform');
                    }
                }
            },

            'Kirsti - Clever Kitsune Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Evolution at turns 2-3 → Queen Bee Kirsti
                if (turns >= 2 && turns <= 3 && unit.card.name === 'Clever Kitsune Kirsti') {
                    unit.card.name = 'Queen Bee Kirsti';
                    unit.card.image = getCardImage('Queen Bee Kirsti');
                    unit.card.atk = 2;
                    unit.card.hp = 3;
                    unit.card.maxHp = 3;
                    unit.card.ability = 'guard';
                    unit.card.description = '**Guard.** On Play: All allies gain **+1 #atk#.** Counter-attacks on hit.\n£{Every hive needs a queen. Every queen needs teeth.}£';
                    unit.status.kirstiVariant = 'Queen Bee Kirsti';
                    unit.card.abilities = {
                        onPlay: [
                            { type: 'giveAllAlliesEffect', effect: { type: 'attackUpSelf', value: 1 } }
                        ],
                        onDeath: [
                            { type: 'spawnCard', cardName: 'Kirsti', amount: 1 }
                        ]
                    };
                    
                    log(`KIRSTI — CLEVER KITSUNE EVOLVES → QUEEN BEE KIRSTI! (1/1 → 2/3 Guard | +1 ATK all allies)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-queen');
                        spawnAbilityRing(el, 'buff');
                        animateCard(el, 'animate-legendary-transform');
                    }
                }
            },

            'Kirsti - Queen Bee Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Evolution at turns 4-5 → Matriarch Hyena Kirsti
                if (turns >= 4 && turns <= 5 && unit.card.name === 'Queen Bee Kirsti') {
                    unit.card.name = 'Matriarch Hyena Kirsti';
                    unit.card.image = getCardImage('Matriarch Hyena Kirsti');
                    unit.card.atk = 4;
                    unit.card.hp = 2;
                    unit.card.maxHp = 2;
                    unit.card.ability = 'berserk';
                    unit.card.description = "**Berserk.** On Hit: Draw **2** cards. On Death: Return **Kirsti** to hand.\\n£{She laughs loudest at the ones who think they've won.}£";
                    unit.status.kirstiVariant = 'Matriarch Hyena Kirsti';
                    unit.card.abilities = {
                        onHit: [
                            { type: 'drawCard', value: 2 }
                        ],
                        onDeath: [
                            { type: 'spawnCard', cardName: 'Kirsti', amount: 1 }
                        ]
                    };
                    
                    log(`KIRSTI — QUEEN BEE EVOLVES → MATRIARCH HYENA KIRSTI! (2/3 → 4/2 Berserk | Draw 2 on hit)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-hyena');
                        spawnAbilityRing(el, 'buff');
                        animateCard(el, 'animate-legendary-transform');
                        spawnFireParticles(el, 8);
                    }
                }
            },

            'Kirsti - Matriarch Hyena Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Evolution at turns 6-9 → Apex Arachnea Kirsti
                if (turns >= 6 && turns <= 9 && unit.card.name === 'Matriarch Hyena Kirsti') {
                    unit.card.name = 'Apex Arachnea Kirsti';
                    unit.card.image = getCardImage('Apex Arachnea Kirsti');
                    unit.card.atk = 5;
                    unit.card.hp = 5;
                    unit.card.maxHp = 5;
                    unit.card.ability = 'none';
                    unit.card.description = 'On Play: Reduce all enemies\' **#atk#** by **5.** Deal damage to the enemy Nexus equal to total #atk# drained.\n£{Eight eyes. No mercy. No escape.}£';
                    unit.status.kirstiVariant = 'Apex Arachnea Kirsti';
                    unit.card.abilities = {
                        onPlay: [
                            { type: 'lowerAllEnemiesAttack', value: 5 },
                            { type: 'damageNexusPerAttackLowered', attackValue: 5 }
                        ]
                    };
                    
                    log(`KIRSTI — MATRIARCH HYENA EVOLVES → APEX ARACHNEA KIRSTI! (4/2 → 5/5 | Lowers enemy ATK, deals to Nexus)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-arachnea');
                        spawnAbilityRing(el, 'dmg');
                        animateCard(el, 'animate-legendary-transform');
                        spawnLightningArc(el, document.getElementById(context.side === 'player' ? 'enemy-hp' : 'player-hp'), '#9333ea');
                    }
                }
            },

            'Kirsti - Apex Arachnea Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Evolution at turns 10-14 → Abyssal Priestress Kirsti
                if (turns >= 10 && turns <= 14 && unit.card.name === 'Apex Arachnea Kirsti') {
                    unit.card.name = 'Abyssal Priestress Kirsti';
                    unit.card.image = getCardImage('Abyssal Priestress Kirsti');
                    unit.card.atk = 6;
                    unit.card.hp = 6;
                    unit.card.maxHp = 6;
                    unit.card.ability = 'guard';
                    unit.card.description = '**Guard.** On Play: Gain **Invincible** for 2 turns. Silence a random enemy for 2 turns. Immune to counter-attacks. Ignores **Guard** for 2 turns.\n£{She does not pray to the abyss. The abyss prays to her.}£';
                    unit.status.kirstiVariant = 'Abyssal Priestress Kirsti';
                    unit.status.invincibleToCounters = true;
                    unit.status.ignoresGuardTurns = 2;
                    unit.card.abilities = {
                        onPlay: [
                            { type: 'applyInvincible', value: 2 },
                            { type: 'silenceRandomEnemy', value: 2 }
                        ]
                    };
                    
                    log(`KIRSTI — APEX ARACHNEA EVOLVES → ABYSSAL PRIESTESS KIRSTI! (5/5 → 6/6 Guard | Invincible to counters, ignores Guard)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-priestress');
                        el.classList.add('is-invincible');
                        spawnAbilityRing(el, 'silence');
                        animateCard(el, 'animate-legendary-transform');
                        spawnManaSparkles(el, 12);
                    }
                }
            },

            'Kirsti - Abyssal Priestress Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onTurnStart') return;
                unit.status.kirstiTurnsAlive = (unit.status.kirstiTurnsAlive || 0) + 1;
                const turns = unit.status.kirstiTurnsAlive;
                
                // Check if Kirsti is on player board and player's nexus HP > 0
                const playerWon = context.side === 'player' && state.eHp > 0 && state.pHp > 0;
                
                // Evolution at turn 15 → Witch Mother Kirsti (only if player is winning and enemy nexus is at 0 or below... actually Kirsti survives so this is about the player winning)
                if (turns === 15 && unit.card.name === 'Abyssal Priestress Kirsti' && playerWon) {
                    unit.card.name = 'Witch Mother Kirsti';
                    unit.card.image = getCardImage('Witch Mother Kirsti');
                    unit.card.atk = 10;
                    unit.card.hp = 10;
                    unit.card.maxHp = 10;
                    unit.card.ability = 'none';
                    unit.card.description = '[rainbow]On Play: Swap both Nexus HP totals.[/rainbow]\n£{What was yours is mine. What was mine was always mine.}£';
                    unit.status.kirstiVariant = 'Witch Mother Kirsti';
                    unit.card.abilities = {
                        onPlay: [
                            { type: 'nexusSwapHp' }
                        ]
                    };
                    
                    log(`KIRSTI — ABYSSAL PRIESTESS EVOLVES → WITCH MOTHER KIRSTI! (6/6 → 10/10 | NEXUS HP SWAP!)`);
                    const el = getSlotCard(context.side, context.slot);
                    if (el) {
                        const imgEl = el.querySelector('img');
                        if (imgEl) { imgEl.src = unit.card.image; imgEl.onerror = () => { cardImageFallback(imgEl, unit.card.name); }; }
                        el.classList.add('kirsti-evolve-witch');
                        spawnAbilityRing(el, 'buff');
                        animateCard(el, 'animate-legendary-transform');
                        // Epic animation
                        spawnFireParticles(el, 15);
                        flashScreen();
                        flashVignette('purple');
                    }
                }
            },

            // M-chan — removes 2 slots from the opposing board on play (restored via JSON onDeath ability)
            'M-chan': async function(unit, eventName, context) {
                if (eventName !== 'onPlay') return;
                // Guard: only fire once (JSON onPlay abilities may also call fireLegendaryPassives)
                if (unit.status.mchanActivated) return;
                unit.status.mchanActivated = true;

                const REMOVED = 2;
                const oppSide  = context.side === 'player' ? 'enemy' : 'player';
                const oppBoard = oppSide === 'enemy' ? state.eBoard : state.pBoard;
                const newSize  = Math.max(1, oppBoard.length - REMOVED);
                const removed  = oppBoard.length - newSize;

                unit.status.mchanSlotsRemoved = removed;
                unit.status.mchanOppSide      = oppSide;

                log(`M-CHAN — LEGENDARY: SHRINKING ${oppSide.toUpperCase()} BOARD BY ${removed} SLOT(S)!`);

                // Animate the slots being removed before they disappear
                for (let i = oppBoard.length - 1; i >= newSize; i--) {
                    const slotEl = document.getElementById(`${oppSide}-slot-${i}`);
                    if (slotEl) slotEl.classList.add('slot-mchan-collapse');
                }

                // Wait for collapse animation before actually removing
                await delay(500);

                for (let i = oppBoard.length - 1; i >= newSize; i--) {
                    if (oppBoard[i]) {
                        log(`${oppBoard[i].card.name.toUpperCase()} LOSES THEIR SLOT AND IS REMOVED.`);
                        await triggerCardEvent('onDeath', oppBoard[i], {
                            slot: i, side: oppSide, board: oppBoard
                        });
                        oppBoard[i] = null;
                    }
                }

                if (oppSide === 'enemy') {
                    state.eBoard = oppBoard.slice(0, newSize);
                } else {
                    state.pBoard = oppBoard.slice(0, newSize);
                }

                setBoardSize(state.pBoard.length, state.eBoard.length);

                // Ice aura on M-chan while she is alive
                const el = getSlotCard(context.side, context.slot);
                if (el) {
                    el.classList.add('mchan-active');
                    spawnAbilityRing(el, 'dmg');
                    animateCard(el, 'animate-legendary-transform');
                    spawnFireParticles(el, 10);
                    flashVignette('red');
                }
            },

            // Post Mortem Kirsti — triggers when any ally (except Kirsti herself) dies while she's alive
            'Post Mortem Kirsti': async function(unit, eventName, context) {
                if (eventName !== 'onDeath') return;
                const dyingUnit = context.dyingUnit;
                if (!dyingUnit || dyingUnit === unit) return; // Don't trigger on self
                
                // Check if this Kirsti is in her evolved form
                if (!unit.status.kirstiVariant || unit.card.name === 'Kirsti') return;
                
                // Spawn Post Mortem Kirsti if not already on board
                const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
                const hasPostMortem = board.some(s => s && s.card && s.card.name === 'Post Mortem Kirsti');
                if (hasPostMortem) return;
                
                const emptyIdx = board.findIndex(s => s === null);
                if (emptyIdx === -1) return;
                
                const postMortem = {
                    card: {
                        name: 'Post Mortem Kirsti',
                        image: getCardImage('Post Mortem Kirsti'),
                        cost: 0,
                        atk: 5,
                        hp: 1,
                        maxHp: 1,
                        rarity: 'LEGENDARY',
                        series: 'Kirsti Evolution',
                        ability: 'echo',
                        description: '**Echo.** On Turn Start: Enemy Nexus **-4 #hp#.** All allies gain **+4 Max #hp#.**\n£{She rose from grief. She will not stop rising.}£',
                        abilities: {
                            onTurnStart: [
                                { type: 'damageNexus', target: 'enemy', value: 4 },
                                { type: 'healAllies', value: 4 }
                            ]
                        }
                    },
                    status: { exhausted: true, justPlayed: true, silenced: false }
                };
                
                board[emptyIdx] = postMortem;
                await triggerCardEvent('onPlay', postMortem, { slot: emptyIdx, side: context.side, board });
                
                log(`KIRSTI — POST MORTEM ACTIVATES! Distraught Kirsti appears — deals 4 to enemy Nexus, allies gain +4 Max HP!`);
                const el = getSlotCard(context.side, emptyIdx);
                if (el) {
                    el.classList.add('kirsti-post-mortem');
                    animateCard(el, 'animate-legendary-transform');
                    spawnFireParticles(el, 10);
                    flashVignette('red');
                }
            },
        };

        // ── fireLegendaryPassives ────────────────────────────────────────────────
        // Called at the end of every triggerCardEvent sweep.
        // Walks every slot on the same board; if it's a living, non-silenced
        // legendary, fires its registered passive with the current event & context.
        // dyingUnit is injected so passives can react to other units' events.
        async function fireLegendaryPassives(eventName, triggeringUnit, context) {
            const board = context.side === 'enemy' ? state.eBoard : state.pBoard;
            for (let idx = 0; idx < board.length; idx++) {
                const slot = board[idx];
                if (!slot || !slot.card) continue;
                if (slot.card.rarity?.toUpperCase() !== 'LEGENDARY') continue;
                if ((slot.status?.silenced ?? 0) > 0) continue; // silenced = passive offline
                let passive = LEGENDARY_PASSIVES[slot.card.name];
                if (!passive) {
                    if (slot.card.name === 'Kirsti') {
                        passive = LEGENDARY_PASSIVES['Kirsti - Kitty Date Kirsti'];
                    } else {
                        passive = LEGENDARY_PASSIVES['Kirsti - ' + slot.card.name];
                    }
                }
                if (!passive) continue;
                await passive(slot, eventName, {
                    ...context,
                    slot: idx,
                    board,
                    dyingUnit: triggeringUnit,   // the unit whose event fired this sweep
                    playedSide: context.side,    // original side, useful for Saya's passive
                });
            }
        }

        async function triggerCardEvent(eventName, unit, context = {}) {
            if (unit?.status?.silenced > 0) {
                console.log(`${unit.card.name} is silenced. Ability ${eventName} blocked.`);
                return;
            }

            if (eventName === 'whenAttacked') {
                unit.status = unit.status || {};
                unit.status.timesAttacked = (unit.status.timesAttacked || 0) + 1;
            }

            const effects = unit?.card?.abilities?.[eventName];
            if (!effects || !Array.isArray(effects)) {
                // Still fire legendary passives even if this unit has no JSON abilities for this event
                await fireLegendaryPassives(eventName, unit, buildAbilityContext(context));
                return;
            }

            const triggerContext = buildAbilityContext(context);
            const scenarioValue = evaluateScenario(unit?.card?.abilities?.scenario, unit, triggerContext);

            console.log(`Triggering ${eventName} for ${unit.card.name}, scenario: ${scenarioValue}`);

            triggerContext.scenario = scenarioValue;

            for (const effect of effects) {
                const result = await applyCardEffect(effect, unit, triggerContext);

                if (result === false) {
                    console.log(`Effect skipped due to scenario or condition`, effect);
                    continue;
                }
            }

            // Fire legendary passives AFTER this unit's own abilities resolve
            await fireLegendaryPassives(eventName, unit, triggerContext);
        }

        async function loadCards() {
            try {
                const url = supabaseStorageUrl('cards.json');
                const response = await fetch(url, {
                    headers: { 'apikey': SUPABASE_KEY }
                });
                if (!response.ok) throw new Error(`cards.json not found (${response.status})`);
                const data = await response.json();
                // CLEAN UP: Just map the basic properties and the image function
                ALL_CHARS = data.map(card => ({
                    ...card,
                    abilities: card.abilities || {},
                    image: card.image || getCardImage(card.name),
                    imageFallback: card.imageFallback || getCardImageJpg(card.name)
                }));
                // Patch M-chan abilities: onPlay is handled by legendary passive,
                // onDeath must fire restoreMchanSlots before her slot is nulled.
                const mchan = ALL_CHARS.find(c => c.name === 'M-chan');
                if (mchan) {
                    mchan.abilities = {
                        onDeath: [{ type: 'restoreMchanSlots' }]
                    };
                }
                log(`Loaded cards.json (${data.length} cards)`);
            } catch (error) {
                console.warn('cards.json could not be loaded', error);
            }
        }

        function spawnRollPopup(el, rolls, best, stat) {
            if (!el) return;
            const rect = el.getBoundingClientRect();

            const popup = document.createElement('div');
            popup.style.cssText = `
                position: fixed;
                left: ${rect.left + rect.width / 2 - 20}px;
                top: ${rect.top - 10}px;
                font-size: 18px;
                font-weight: 900;
                color: white;
                text-shadow: 0 0 8px rgba(255,255,255,0.8);
                z-index: 9999;
                pointer-events: none;
                transition: transform 0.15s ease, opacity 0.3s ease;
                min-width: 40px;
                text-align: center;
            `;
            document.body.appendChild(popup);

            // Flicker through rolls, then land on best
            let i = 0;
            const flicker = setInterval(() => {
                if (i < rolls.length) {
                    popup.textContent = `🎲 ${rolls[i]}`;
                    popup.style.color = 'white';
                    i++;
                } else {
                    clearInterval(flicker);
                    // Land on the best roll with colour + float up
                    popup.textContent = `+${best} ${stat === 'hp' ? '❤️' : '⚔️'}`;
                    popup.style.color = stat === 'hp' ? '#86efac' : '#f87171';
                    popup.style.fontSize = '22px';
                    popup.style.textShadow = `0 0 12px ${stat === 'hp' ? '#4ade80' : '#ef4444'}`;
                    popup.style.transform = 'translateY(-30px)';
                    setTimeout(() => {
                        popup.style.opacity = '0';
                        setTimeout(() => popup.remove(), 300);
                    }, 900);
                }
            }, 120); // 120ms per roll shown — fast enough to feel like tumbling
        }

        // Abilities:
        // guard: enemy must target this unit if able
        // echo: can be played on same turn as drawn
        // haste: can attack the turn it's played, but not if it has echo
        // haste2: can attack twice the turn it's played, but not if it has echo
        // berserk: excess damage dealt to a unit that kills it is dealt to the enemy nexus
        // heal: heals your nexus for half the attack (rounded up) when it strikes
        // silence: silences the target unit when it strikes, preventing it from attacking next turn or using haste/echo
        // snipe: can strike enemy units and nexus without being blocked by guards, but cannot strike if any guards are present on enemy board
        // splash: when this unit strikes, it also deals 1 damage to adjacent units on enemy board
        // disable: can target an enemy unit to exhaust it and prevent it from readying next turn

        let state = {
            pHp: 30, eHp: 30,
            mana: 1, maxMana: 1,
            hand: [],
            pBoard: [null, null, null, null],
            eBoard: [null, null, null, null],
            dragging: null,
            activeScreen: 'lobby'
        };

        function animateCard(el, className) {
            if(!el) return;
            el.classList.add(className);
            setTimeout(() => el.classList.remove(className), 600);
        }

        function getSlotCard(side, idx) {
            return document.querySelector(`#${side}-slot-${idx} .card-nexus`);
        }

        function getPlayerHandCard(index) {
            return document.querySelector(`#player-hand .card-nexus:nth-child(${index + 1})`);
        }

        function showScreen(id) {
            state.activeScreen = id;
            document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden-screen'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            
            document.getElementById(`screen-${id}`).classList.remove('hidden-screen');
            const btn = document.getElementById(`btn-${id}`);
            if(btn) btn.classList.add('active');
            document.getElementById('screen-title').innerText = id.toUpperCase();
            
            if(id === 'vault') renderVault();
            if(id === 'library') renderLibrary();
            if(id === 'collection') renderCollection();
            if(id === 'lobby') updateLobbyStats();
            // Arena now requires user confirmation via modal - removed auto-start
        }
        window.showScreen = showScreen;

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const main = document.getElementById('main-content');
            const toggleIcon = document.querySelector('#sidebar-toggle i');
            const mobileToggleIcon = document.querySelector('#mobile-sidebar-toggle i');

            sidebar.classList.toggle('collapsed');
            main.classList.toggle('sidebar-collapsed');

            const isCollapsed = sidebar.classList.contains('collapsed');

            if (toggleIcon) {
                toggleIcon.dataset.lucide = isCollapsed ? 'chevrons-right' : 'chevrons-left';
            }

            if (mobileToggleIcon) {
                mobileToggleIcon.dataset.lucide = isCollapsed ? 'menu' : 'x';
            }

            lucide.createIcons();

            document.querySelectorAll('.nav-text, .sidebar-title, .sidebar-user-text, .sidebar-quickstart-text').forEach(el => {
                if (isCollapsed) el.classList.add('hidden'); else el.classList.remove('hidden');
            });
        }

        function handleResponsiveSidebar() {
            const sidebar = document.getElementById('sidebar');
            const main = document.getElementById('main-content');

            if (window.innerWidth <= 768) {
                sidebar.classList.add('collapsed');
                main.classList.add('sidebar-collapsed');
                const mobileToggleIcon = document.querySelector('#mobile-sidebar-toggle i');
                if (mobileToggleIcon) mobileToggleIcon.dataset.lucide = 'menu';
            } else {
                sidebar.classList.remove('collapsed');
                main.classList.remove('sidebar-collapsed');
                const mobileToggleIcon = document.querySelector('#mobile-sidebar-toggle i');
                if (mobileToggleIcon) mobileToggleIcon.dataset.lucide = 'menu';
            }
            lucide.createIcons();
        }

        window.addEventListener('resize', handleResponsiveSidebar);
        window.addEventListener('DOMContentLoaded', handleResponsiveSidebar);

        async function renderVault() {
            const grid = document.getElementById('vault-grid');
            grid.innerHTML = '';

            // Update character count
            document.getElementById('vault-count').textContent = `${ALL_CHARS.length} Units Synchronized`;

            // Only show cards that are NOT marked as Key Cards
            const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);

            // Group characters by series
            const seriesGroups = {};
            collectibleCards.forEach(c => {
                if (!seriesGroups[c.series]) {
                    seriesGroups[c.series] = [];
                }
                seriesGroups[c.series].push(c);
            });

            // Sort series alphabetically
            const sortedSeries = Object.keys(seriesGroups).sort();

            // Create sections for each series
            for (const series of sortedSeries) {
                // Create series header
                const headerDiv = document.createElement('div');
                headerDiv.className = 'series-header';
                headerDiv.innerHTML = `
                    <h3 class="text-xl font-bold text-indigo-400 mb-4 mt-8 first:mt-0">${series}</h3>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-16 mb-8"></div>
                `;
                grid.appendChild(headerDiv);

                // Add characters to this series
                const seriesGrid = headerDiv.querySelector('.grid');
                for (const c of seriesGroups[series]) {
                    const cardDiv = await createCardUI(c, 0, 'preview');
                    seriesGrid.appendChild(cardDiv);
                }
            }
        }

        // Cache for formatDescription results to avoid redundant fetches
        const _descCache = new Map();

        async function formatDescription(text, skipLoreImages = false) {
            if (!text) return 'No special abilities.';

            // Return cached result when lore images aren't needed (e.g. library preview)
            const cacheKey = text + (skipLoreImages ? '__nolore' : '');
            if (_descCache.has(cacheKey)) return _descCache.get(cacheKey);

            // 1. Lore Links: [[DisplayText|ImageName1|ImageName2]]
            const matches = [...text.matchAll(/\[\[(.*?)]]/g)];
            
            for (const match of matches) {
                const content = match[1];
                let displayText;
                let imageNames = [];

                if (content.includes('|')) {
                    const parts = content.split('|');
                    displayText = parts[0].trim();
                    imageNames = parts.slice(1).map(p => p.trim());
                } else {
                    displayText = content;
                    imageNames = [content];
                }

                // In preview/library mode skip expensive blob fetches — just render the link text
                if (skipLoreImages) {
                    const replacement = `<span class="lore-link">${displayText}</span>`;
                    text = text.replace(match[0], replacement);
                    continue;
                }

                let imgTagsHTML = '';
                for (const imgName of imageNames) {
                    const linkedCard = typeof ALL_CHARS !== 'undefined'
                        ? ALL_CHARS.find(c => c.name.toLowerCase() === imgName.toLowerCase())
                        : null;

                    const imgPath = linkedCard ? (linkedCard.image || getCardImage(linkedCard.name)) : '';
                    const imgFallback = linkedCard ? (linkedCard.imageFallback || getCardImageJpg(linkedCard.name)) : '';

                    if (imgPath) {
                        // Fetch with API key header and use a blob URL so Supabase auth works on <img> tags
                        const blobUrl = await (async () => {
                            try {
                                const res = await fetch(imgPath, { headers: { 'apikey': SUPABASE_KEY } });
                                if (res.ok) return URL.createObjectURL(await res.blob());
                            } catch (_) {}
                            // Fallback to .jpg if .png fetch failed
                            try {
                                const res2 = await fetch(imgFallback, { headers: { 'apikey': SUPABASE_KEY } });
                                if (res2.ok) return URL.createObjectURL(await res2.blob());
                            } catch (_) {}
                            return '';
                        })();

                        if (blobUrl) {
                            imgTagsHTML += `
                        <div class="flex flex-col items-center justify-center flex-1">
                            <img src="${blobUrl}" class="w-full h-full object-cover rounded-md aspect-square">
                        </div>`;
                        }
                    }
                }

                if (!imgTagsHTML) {
                    imgTagsHTML = '<div class="p-2 text-[10px] text-white">?</div>';
                }

                const customClass = content.includes('|') ? 'is-custom' : '';
                const replacement = `
                    <span class="lore-link ${customClass}">
                        ${displayText}
                        <div class="lore-tooltip flex gap-2 p-1">
                            ${imgTagsHTML}
                        </div>
                    </span>`;
                    
                text = text.replace(match[0], replacement);
            }

            // 2. Lore/Italic text: £{Text}£
                text = text.replace(/£\{(.+?)\}£/g, '<span class="italic text-white/70" style="font-size: 11px;">$1</span>');

                // 3. Bold text with glow: **Text**
                text = text.replace(/\*\*([^\*]+)\*\*/g, '<span class="font-black text-white" style="text-shadow: rgba(255, 255, 255, 0.6) 0px 0px 10px;">$1</span>');

                // 4. Dynamic Font Size: _16px_Text_
                text = text.replace(/_(\d+px)_([^_]+)_/g, '<span style="font-size: $1; font-weight: bold;">$2</span>');

                // 5. Color tags: /color/text/
                text = text.replace(/\/([a-zA-Z]+)\/([^\/]+)\//g, '<span style="color: $1;">$2</span>');

                // 6. Horizontal line: --- must be standalone (surrounded by whitespace, newlines, or start/end of string)
                text = text.replace(/(^|[\s\n])---([\s\n]|$)/g, '$1<div class="w-full h-px bg-gradient-to-r from-transparent via-purple-400/50 to-transparent my-1"></div>$2');

                // 7. Rainbow Text: [rainbow]Text[/rainbow]
                text = text.replace(/\[rainbow\](.*?)\[\/rainbow\]/g, '<span class="font-black animate-pulse" style="background: linear-gradient(to right, rgb(239, 68, 68), rgb(234, 179, 8), rgb(34, 197, 94), rgb(59, 130, 246), rgb(168, 85, 247)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">$1</span>');

                // 8. Shaking/Bouncing Text: {shake}Text{/shake}
                text = text.replace(/\{shake\}(.*?)\{\/shake\}/g, '<span class="font-bold inline-block animate-bounce text-red-400">$1</span>');

                // 9. Stat Icons: #atk#, #hp#, #cost#
                text = text.replace(/#atk#/g, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-red-500 inline-block align-middle mx-0.5"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" x2="19" y1="19" y2="13"></line><line x1="16" x2="20" y1="16" y2="20"></line><line x1="19" x2="21" y1="21" y2="19"></line><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"></polyline><line x1="5" x2="9" y1="14" y2="18"></line><line x1="7" x2="4" y1="17" y2="20"></line><line x1="3" x2="5" y1="19" y2="21"></line></svg>`);
                text = text.replace(/#hp#/g, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-green-500 inline-block align-middle mx-0.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`);
                text = text.replace(/#cost#/g, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-indigo-400 inline-block align-middle mx-0.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`);

                // 10. Replace newlines with <br>
                text = text.replace(/\\n/g, '<br>');

                // 11. Hidden Text: {{hidden}}Text{{/hidden}}
                // Use [\s\S] to match across multiple lines
                text = text.replace(/\{\{hidden\}\}([\s\S]*?)\{\{\/hidden\}\}/g, '<span class="hidden-trigger">$1</span>');

                // 12. Flatten (Vertical Scale) or stretch (Horizontal Scale)
                // [flat*N] squishes vertically → scaleY
                text = text.replace(/\[flat\*(\d+)\](.*?)\[\/flat\]/g, '<span style="display: inline-block; transform: scaleY($1%);">$2</span>');

                // [stretch*N] stretches horizontally → scaleX
                text = text.replace(/\[stretch\*(\d+)\](.*?)\[\/stretch\]/g, '<span style="display: inline-block; transform: scaleX($1%);">$2</span>');

                // 13. Glitch Text: [glitch]Text[/glitch]
                // Eerie flickering glitch effect with red/cyan pseudo-elements via animation
                text = text.replace(/\[glitch\](.*?)\[\/glitch\]/g, '<span class="desc-glitch" data-text="$1">$1</span>');

                // 14. Fire Text: [fire]Text[/fire]
                // Animated gradient cycling through fire colours bottom-to-top
                text = text.replace(/\[fire\](.*?)\[\/fire\]/g, '<span class="desc-fire font-black">$1</span>');

                // 15. Ice Text: [ice]Text[/ice]
                // Cool shimmer sweep across a blue/white gradient
                text = text.replace(/\[ice\](.*?)\[\/ice\]/g, '<span class="desc-ice font-bold">$1</span>');

                // 16. Shadow Text: [shadow]Text[/shadow]
                // Deep pulsing dark aura glow
                text = text.replace(/\[shadow\](.*?)\[\/shadow\]/g, '<span class="desc-shadow font-bold">$1</span>');

                // 17. Gold/Legendary Text: [gold]Text[/gold]
                // Shimmer sweep across rich gold gradient
                text = text.replace(/\[gold\](.*?)\[\/gold\]/g, '<span class="desc-gold font-black">$1</span>');

                // 18. Electric Text: [electric]Text[/electric]
                // Rapid flickering + yellow-white glow simulating electricity
                text = text.replace(/\[electric\](.*?)\[\/electric\]/g, '<span class="desc-electric font-bold">$1</span>');

                // 19. Typewriter Text: [type]Text[/type]
                // Characters appear one by one using character reveal animation
                text = text.replace(/\[type\](.*?)\[\/type\]/g, (_, inner) => {
                    const chars = [...inner].map((ch, i) =>
                        `<span class="desc-typechar" style="animation-delay:${i * 60}ms">${ch === ' ' ? '&nbsp;' : ch}</span>`
                    ).join('');
                    return `<span class="desc-typewriter">${chars}</span>`;
                });

                // 20. Spin Text: [spin]Text[/spin]
                // Continuously rotates 360° (good for ⚙ icons or single words)
                text = text.replace(/\[spin\](.*?)\[\/spin\]/g, '<span class="desc-spin inline-block">$1</span>');

                // 21. Corrupt Text: [corrupt]Text[/corrupt]
                // Randomly swaps characters to look corrupted/glitched (CSS only approximation: flicker + skew)
                text = text.replace(/\[corrupt\](.*?)\[\/corrupt\]/g, '<span class="desc-corrupt font-mono font-black">$1</span>');

                // 22. Neon Text: [neon]Text[/neon]
                // Bright neon pink/magenta pulsing glow
                text = text.replace(/\[neon\](.*?)\[\/neon\]/g, '<span class="desc-neon font-black">$1</span>');

                // 23. Wave Text: [wave]Text[/wave]
                // Each character bobs up and down in a sine wave
                text = text.replace(/\[wave\](.*?)\[\/wave\]/g, (_, inner) => {
                    const chars = [...inner].map((ch, i) =>
                        `<span class="desc-wavechar inline-block" style="animation-delay:${i * 80}ms">${ch === ' ' ? '&nbsp;' : ch}</span>`
                    ).join('');
                    return `<span>${chars}</span>`;
                });

                // 24. Void Text: [void]Text[/void]
                // Dark purple swirling gradient with slow spin — feels ancient/cosmic
                text = text.replace(/\[void\](.*?)\[\/void\]/g, '<span class="desc-void font-black">$1</span>');

                // 25. Blood Text: [blood]Text[/blood]
                // Dark crimson with drip-flicker animation
                text = text.replace(/\[blood\](.*?)\[\/blood\]/g, '<span class="desc-blood font-black">$1</span>');

                // Inject shared keyframes + classes once per page
                if (!document.getElementById('desc-fx-styles')) {
                    const style = document.createElement('style');
                    style.id = 'desc-fx-styles';
                    style.textContent = `
                        /* ── GLITCH ── */
                        @keyframes desc-glitch-anim {
                            0%,100%{clip-path:inset(50% 0 30% 0);transform:translate(-3px,0) skewX(-1deg)}
                            20%{clip-path:inset(10% 0 60% 0);transform:translate(3px,0) skewX(2deg)}
                            40%{clip-path:inset(80% 0 5% 0);transform:translate(-2px,0)}
                            60%{clip-path:inset(30% 0 40% 0);transform:translate(2px,1px)}
                            80%{clip-path:inset(5% 0 80% 0);transform:translate(0,-1px)}
                        }
                        .desc-glitch {
                            position: relative;
                            color: #e2e8f0;
                            text-shadow: 0 0 4px #a78bfa;
                        }
                        .desc-glitch::before,
                        .desc-glitch::after {
                            content: attr(data-text);
                            position: absolute;
                            left: 0; top: 0;
                            width: 100%; height: 100%;
                            pointer-events: none;
                        }
                        .desc-glitch::before {
                            color: #f87171;
                            animation: desc-glitch-anim 2.5s infinite steps(1);
                            opacity: 0.8;
                        }
                        .desc-glitch::after {
                            color: #67e8f9;
                            animation: desc-glitch-anim 2.5s infinite steps(1) reverse;
                            opacity: 0.7;
                        }

                        /* ── FIRE ── */
                        @keyframes desc-fire-shift {
                            0%{background-position:0% 100%}
                            50%{background-position:100% 0%}
                            100%{background-position:0% 100%}
                        }
                        .desc-fire {
                            background: linear-gradient(to top, #fbbf24, #f97316, #ef4444, #fde68a, #f97316);
                            background-size: 200% 300%;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            animation: desc-fire-shift 1.4s ease infinite;
                            text-shadow: none;
                            filter: drop-shadow(0 0 6px #f9731688);
                        }

                        /* ── ICE ── */
                        @keyframes desc-ice-shimmer {
                            0%{background-position:200% center}
                            100%{background-position:-200% center}
                        }
                        .desc-ice {
                            background: linear-gradient(90deg, #bfdbfe, #e0f2fe, #ffffff, #93c5fd, #bfdbfe);
                            background-size: 300% auto;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            animation: desc-ice-shimmer 2.5s linear infinite;
                            filter: drop-shadow(0 0 5px #7dd3fc88);
                        }

                        /* ── SHADOW ── */
                        @keyframes desc-shadow-pulse {
                            0%,100%{text-shadow:0 0 8px #7c3aed,0 0 20px #4c1d95,0 0 40px #1e1b4b}
                            50%{text-shadow:0 0 4px #6d28d9,0 0 10px #2e1065}
                        }
                        .desc-shadow {
                            color: #c4b5fd;
                            animation: desc-shadow-pulse 2s ease-in-out infinite;
                        }

                        /* ── GOLD ── */
                        @keyframes desc-gold-shimmer {
                            0%{background-position:200% center}
                            100%{background-position:-200% center}
                        }
                        .desc-gold {
                            background: linear-gradient(90deg, #78350f, #fbbf24, #fef3c7, #f59e0b, #d97706, #fef3c7, #fbbf24);
                            background-size: 300% auto;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            animation: desc-gold-shimmer 2s linear infinite;
                            filter: drop-shadow(0 0 5px #fbbf2466);
                        }

                        /* ── ELECTRIC ── */
                        @keyframes desc-electric-flicker {
                            0%,100%{opacity:1;text-shadow:0 0 6px #fef08a,0 0 14px #facc15,0 0 28px #eab308}
                            15%{opacity:0.7;text-shadow:0 0 2px #fef9c3}
                            30%{opacity:1;text-shadow:0 0 8px #fef08a,0 0 20px #facc15}
                            50%{opacity:0.85;text-shadow:0 0 4px #fef08a}
                            70%{opacity:1;text-shadow:0 0 10px #fef08a,0 0 22px #eab308}
                            85%{opacity:0.6;text-shadow:none}
                        }
                        .desc-electric {
                            color: #fef08a;
                            animation: desc-electric-flicker 1.2s steps(1) infinite;
                        }

                        /* ── TYPEWRITER ── */
                        @keyframes desc-typechar-reveal {
                            from{opacity:0;transform:translateY(-4px)}
                            to{opacity:1;transform:translateY(0)}
                        }
                        .desc-typewriter { display: inline; }
                        .desc-typechar {
                            opacity: 0;
                            display: inline-block;
                            animation: desc-typechar-reveal 0.12s ease forwards;
                        }

                        /* ── SPIN ── */
                        @keyframes desc-spin-anim {
                            from{transform:rotate(0deg)}
                            to{transform:rotate(360deg)}
                        }
                        .desc-spin {
                            animation: desc-spin-anim 2s linear infinite;
                            display: inline-block;
                        }

                        /* ── CORRUPT ── */
                        @keyframes desc-corrupt-anim {
                            0%,100%{transform:skewX(0deg) skewY(0deg);opacity:1;filter:none}
                            10%{transform:skewX(5deg);opacity:0.7;filter:hue-rotate(90deg)}
                            20%{transform:skewX(-3deg) skewY(1deg);opacity:1;filter:none}
                            35%{transform:skewX(0deg);filter:hue-rotate(180deg);opacity:0.5}
                            50%{transform:skewX(4deg) skewY(-1deg);opacity:1;filter:none}
                            65%{transform:none;opacity:0.6;filter:hue-rotate(270deg)}
                            80%{transform:skewX(-2deg);opacity:1;filter:none}
                        }
                        .desc-corrupt {
                            color: #f87171;
                            animation: desc-corrupt-anim 3s steps(1) infinite;
                            display: inline-block;
                        }

                        /* ── NEON ── */
                        @keyframes desc-neon-pulse {
                            0%,100%{text-shadow:0 0 4px #f0abfc,0 0 10px #e879f9,0 0 20px #a21caf,0 0 40px #86198f}
                            50%{text-shadow:0 0 2px #f0abfc,0 0 6px #e879f9,0 0 12px #a21caf}
                        }
                        .desc-neon {
                            color: #f0abfc;
                            animation: desc-neon-pulse 1.8s ease-in-out infinite;
                        }

                        /* ── WAVE ── */
                        @keyframes desc-wave-bob {
                            0%,100%{transform:translateY(0)}
                            50%{transform:translateY(-5px)}
                        }
                        .desc-wavechar {
                            animation: desc-wave-bob 0.8s ease-in-out infinite;
                            color: #a5f3fc;
                        }

                        /* ── VOID ── */
                        @keyframes desc-void-rotate {
                            0%{background-position:0% 50%}
                            50%{background-position:100% 50%}
                            100%{background-position:0% 50%}
                        }
                        .desc-void {
                            background: linear-gradient(270deg, #1e1b4b, #4c1d95, #7c3aed, #312e81, #2e1065, #6d28d9);
                            background-size: 400% 400%;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            animation: desc-void-rotate 4s ease infinite;
                            filter: drop-shadow(0 0 6px #7c3aed88);
                        }

                        /* ── BLOOD ── */
                        @keyframes desc-blood-drip {
                            0%,100%{text-shadow:0 0 6px #991b1b,0 2px 8px #7f1d1d;opacity:1}
                            30%{text-shadow:0 4px 12px #dc2626,0 0 4px #991b1b;opacity:0.85}
                            60%{text-shadow:0 1px 4px #7f1d1d;opacity:1}
                        }
                        .desc-blood {
                            color: #fca5a5;
                            animation: desc-blood-drip 2.2s ease-in-out infinite;
                        }
                    `;
                    document.head.appendChild(style);
                }

            _descCache.set(cacheKey, text);
            return text;
        }

        async function createCardUI(card, index, type, status = {}, skipLoreImages = false) {
            // card.image is now a plain URL string
            const imageSrc = card.image || '';
            const imageFallback = card.imageFallback || '';
            const descriptionHTML = await formatDescription(card.description, skipLoreImages);

            const div = document.createElement('div');

            // ADDED: ${status.silenced ? 'silenced' : ''} to the className list
            div.className = `card-nexus rarity-${card.rarity.toLowerCase()}
                ${status.exhausted ? 'is-exhausted' : ''}
                ${status.silenced ? 'silenced' : ''}
                ${status.invincible > 0 ? 'is-invincible' : ''}
                ${status.shield > 0 ? 'has-shield' : ''}
                ${card.ability === 'guard' ? 'is-guard' : ''}
                ${type === 'preview' ? 'card-vault' : ''}`;
                
            // Only apply entry animation once
            const anims = { 'COMMON': 'anim-common', 'UNCOMMON': 'anim-uncommon', 'RARE': 'anim-rare', 'EPIC': 'anim-epic', 'LEGENDARY': 'anim-legendary' };
            if(status.justPlayed) {
                div.classList.add(anims[card.rarity]);
            }



            if(type !== 'preview') div.draggable = true;

                // Set rank data attribute for CSS border tinting
            if (card.rank) div.dataset.rank = card.rank.toUpperCase();

            div.innerHTML = `
                        ${type !== 'board' ? `<div class="cost-badge">${card.cost}</div>` : ''}
                        <div class="rarity-badge">${card.rarity}</div>
                        ${card.rank ? `<div class="rank-badge rank-${card.rank.toUpperCase()}">${card.rank.toUpperCase()}</div>` : ''}
                        <div class="card-title-container flex-1 flex flex-col items-center pointer-events-none">
                            <img src="${imageSrc}" onerror="cardImageFallback(this,'${card.name.replace(/'/g, "\\'")}')" crossorigin="anonymous" class="w-8 h-8 mb-1 object-contain" alt="${card.name}">
                            <div id="card-title" class="text-[9px] font-black leading-tight uppercase px-1">${card.name}</div>
                        </div>
                        <div class="description-box">${descriptionHTML}</div>
                        <div class="stat-badge atk-badge">${card.atk}</div>
                        <div class="stat-badge hp-badge">${card.hp}</div>
                    `;

            // Rank-based summon animation (overrides default is-summoning)
            if (status.justPlayed && card.rank) {
                const rankAnimMap = { D: null, C: 'summon-C', B: 'summon-B', A: 'summon-A', S: 'summon-S', SS: 'summon-SS' };
                const rankAnim = rankAnimMap[card.rank.toUpperCase()];
                if (rankAnim) {
                    div.classList.remove('is-summoning');
                    div.classList.add(rankAnim);
                    setTimeout(() => div.classList.remove(rankAnim), 1200);
                }
            }

            

            // ... (Keep your existing drag events) ...
                    if(type !== 'preview') {
                        div.ondragstart = (e) => { 
                            state.dragging = { type, index }; 
                            e.dataTransfer.setData('text/plain', '');
                            e.currentTarget.style.opacity = '0.5';
                            // Hide preview while dragging
                            document.getElementById('card-preview-panel').classList.remove('active');
                        };
                        div.ondragend = (e) => {
                            e.currentTarget.style.opacity = '1';
                        }
                    }

                    // NEW: Hover mechanics for the Preview Panel
                    div.addEventListener('mouseenter', () => {
                        const previewPanel = document.getElementById('card-preview-panel');
                        if (previewPanel && !state.dragging) {
                            previewPanel.innerHTML = ''; // Clear old card
                            const clone = div.cloneNode(true); // Copy the exact card HTML
                            
                            // Remove drag events and animations from the clone
                            clone.ondragstart = null;
                            clone.style.animation = 'none'; 
                            
                            previewPanel.appendChild(clone);
                            previewPanel.classList.add('active');
                        }
                    });

                    div.addEventListener('mouseleave', () => {
                        const previewPanel = document.getElementById('card-preview-panel');
                        if (previewPanel) {
                            previewPanel.classList.remove('active');
                        }
                    });

                    
                    // Inside your UI update function (e.g., updateBattleUI)
                    state.pBoard.forEach((u, i) => {
                        const cardEl = document.querySelector(`.player-slot[data-idx="${i}"] .card`);
                        if (u && cardEl) {
                            // Toggle the 'silenced' class based on the unit's status
                            if (u.status && u.status.silenced) {
                                cardEl.classList.add('silenced');
                            } else {
                                cardEl.classList.remove('silenced');
                            }
                        }
                    });

                    return div;
                }
        ;

        function startBattleInternal() {

            state.pHp = 30; state.eHp = 30; state.mana = 1; state.maxMana = 1;

            state.hand = []; state.pBoard = [null, null, null, null]; state.eBoard = [null, null, null, null];

            // --- FORCED MULTIPLE CARDS ---
                // Add as many names as you want (up to 4)
                const startingNames = [];
                
                startingNames.forEach(name => {
                    const found = ALL_CHARS.find(c => c.name === name);
                    if (found && state.hand.length < 4) {
                        state.hand.push({ ...found });
                    }
                });

                // Fill any remaining empty slots (up to 4) with random cards
                while (state.hand.length < 4) {
                    draw();
                }
                // ----------------------------

            updateBattleUI();

            log("Battle Interface Online. Ready.");
        }

        function startBattle() {
            // Check if player has a valid deck before entering arena
            if (!checkDeckBeforeBattle()) {
                return;
            }
            showScreen('arena');
            startBattleInternal();
        }

        /**
         * Changes the number of slots on the player and/or enemy board.
         *
         * @param {number} playerSlots - New number of player board slots (e.g. 5)
         * @param {number} enemySlots  - New number of enemy board slots (e.g. 5)
         *
         * Call this BEFORE startBattleInternal() or at the start of a battle.
         * Example: setBoardSize(5, 5);
         */
        function setBoardSize(playerSlots, enemySlots) {
            // ── 1. Resize the state arrays ─────────────────────────────────────────
            // Grow: pad with nulls. Shrink: truncate (cards in removed slots are lost).
            const resizeBoard = (board, newSize) => {
                if (newSize > board.length) {
                    return [...board, ...Array(newSize - board.length).fill(null)];
                }
                return board.slice(0, newSize);
            };

            state.pBoard = resizeBoard(state.pBoard, playerSlots);
            state.eBoard = resizeBoard(state.eBoard, enemySlots);

            // ── 2. Sync the DOM slot elements ─────────────────────────────────────
            const syncDOMSlots = (side, newCount) => {
                // Find the container by locating slot-0 and using its parentElement —
                // avoids hardcoding a container ID that may differ in the HTML.
                const slot0 = document.getElementById(`${side}-slot-0`);
                if (!slot0) {
                    console.warn(`setBoardSize: could not find #${side}-slot-0 anchor`);
                    return;
                }
                const container = slot0.parentElement;
                if (!container) {
                    console.warn(`setBoardSize: #${side}-slot-0 has no parent`);
                    return;
                }

                const existing = container.querySelectorAll(`.slot[data-side="${side}"]`);
                const currentCount = existing.length;

                // Remove extra slots (shrink)
                for (let i = newCount; i < currentCount; i++) {
                    const el = document.getElementById(`${side}-slot-${i}`);
                    if (el) el.remove();
                }

                // Clone slot-0 as a template to add new ones (grow)
                if (newCount > currentCount) {
                    const template = slot0;
                    for (let i = currentCount; i < newCount; i++) {
                        const clone = template.cloneNode(false); // shallow — no stale card content
                        clone.id = `${side}-slot-${i}`;
                        clone.dataset.idx = i;
                        clone.dataset.side = side;
                        clone.innerHTML = '';
                        clone.setAttribute('ondragover', 'allowDrop(event)');
                        clone.setAttribute('ondrop', 'dropOnSlot(event)');
                        container.appendChild(clone);
                    }
                }
            };

            syncDOMSlots('player', playerSlots);
            syncDOMSlots('enemy', enemySlots);

            // ── 3. Store counts for updateBattleUI's patched render loop ──────────
            window._boardSlotCount = { player: playerSlots, enemy: enemySlots };

            // ── 4. Refresh the UI ─────────────────────────────────────────────────
            updateBattleUI();
        }

        function draw() {
            if (state.hand.length < 4) {

                // Only show cards that are NOT marked as Key Cards
                const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);
                // Correctly picks a random card from the array using a numeric index
                const randomCard = collectibleCards[Math.floor(Math.random() * collectibleCards.length)];
                if (randomCard) {
                    state.hand.push({ ...randomCard });
                }
            }
        }

        // Returns a stable key for a card unit's visible state.
        // renderBattleSlot uses this to skip re-rendering (and re-loading images)
        // when nothing about the card has actually changed.
        function _slotKey(unit) {
            if (!unit) return '__empty__';
            const s = unit.status;
            return [
                unit.card.name, unit.card.hp, unit.card.atk,
                s.exhausted ? 1 : 0,
                s.silenced  ? 1 : 0,
                s.justPlayed ? 1 : 0,
                s.invincible || 0,
                s.shield     || 0,
            ].join('|');
        }

        // Structural key: everything that requires a full card rebuild (name, status flags).
        // If only this is unchanged but stats changed, we can patch in-place instead.
        function _structuralKey(unit) {
            if (!unit) return '__empty__';
            const s = unit.status;
            return [
                unit.card.name,
                s.exhausted  ? 1 : 0,
                s.silenced   ? 1 : 0,
                s.justPlayed ? 1 : 0,
                s.invincible || 0,
                s.shield     || 0,
            ].join('|');
        }

        // Stat key: only atk and hp — the two values we can patch without a full rebuild.
        function _statKey(unit) {
            if (!unit) return '__empty__';
            return `${unit.card.atk}|${unit.card.hp}`;
        }

        // Surgically update just the ATK and HP badges on an already-rendered card element.
        // Returns true if the patch was applied, false if the card element wasn't found.
        function _patchCardStats(slot, unit) {
            const cardEl = slot.querySelector('.card-nexus');
            if (!cardEl) return false;
            const atkEl = cardEl.querySelector('.atk-badge');
            const hpEl  = cardEl.querySelector('.hp-badge');
            if (!atkEl || !hpEl) return false;
            atkEl.textContent = unit.card.atk;
            hpEl.textContent  = unit.card.hp;
            return true;
        }

        // Arrange hand cards in a fan layout
        function applyHandFan() {
            const handEl = document.getElementById('player-hand');
            const cards = Array.from(handEl.children);
            const total = cards.length;
            if (total === 0) return;

            const maxAngle = 20; // max fan angle in degrees
            const angleStep = total > 1 ? maxAngle / (total - 1) : 0;
            const startAngle = -maxAngle / 2;

            cards.forEach((card, i) => {
                const angle = startAngle + i * angleStep;
                card.style.transform = `rotate(${angle}deg)`;
                card.style.transformOrigin = 'bottom center';
            });
        }

        async function updateBattleUI() {
            if(state.activeScreen !== 'arena') return;
            document.getElementById('player-hp').innerText = state.pHp;
            document.getElementById('enemy-hp').innerText = state.eHp;
            document.getElementById('mana-text').innerText = `${state.mana} / ${state.maxMana}`;

            // Hand: full rebuild only when card count changes; otherwise patch individual slots
            const handEl = document.getElementById('player-hand');
            const existingCards = Array.from(handEl.children);
            if (existingCards.length !== state.hand.length) {
                const newHand = document.createDocumentFragment();
                for (const [i, c] of state.hand.entries()) {
                    const cardDiv = await createCardUI(c, i, 'hand');
                    newHand.appendChild(cardDiv);
                }
                handEl.innerHTML = '';
                handEl.appendChild(newHand);
            } else {
                for (const [i, c] of state.hand.entries()) {
                    const key = _slotKey({ card: c, status: {} });
                    if (existingCards[i]?.dataset.slotKey !== key) {
                        const cardDiv = await createCardUI(c, i, 'hand');
                        cardDiv.dataset.slotKey = key;
                        handEl.replaceChild(cardDiv, existingCards[i]);
                    }
                }
            }

            const _pLen = (window._boardSlotCount?.player) ?? state.pBoard.length;
            const _eLen = (window._boardSlotCount?.enemy)  ?? state.eBoard.length;
            for (let i = 0; i < Math.max(_pLen, _eLen); i++) {
                if (i < _pLen) await renderBattleSlot('player', i);
                if (i < _eLen) await renderBattleSlot('enemy', i);
            }

            applyHandFan();
            markReadyCards();
        }

        async function renderBattleSlot(side, idx) {
            const slot = document.getElementById(`${side}-slot-${idx}`);
            const unit = side === 'player' ? state.pBoard[idx] : state.eBoard[idx];
            const newKey = _slotKey(unit);

            // Skip re-render entirely if nothing visible changed - keeps images stable
            if (slot.dataset.slotKey === newKey) return;

            const newStructKey = _structuralKey(unit);
            const newStatKey   = _statKey(unit);

            // If only atk/hp changed (structural key matches), patch the badges in-place.
            // This avoids a full innerHTML rebuild and keeps the card image stable.
            if (
                unit &&
                slot.dataset.structuralKey === newStructKey &&
                slot.dataset.statKey !== newStatKey &&
                _patchCardStats(slot, unit)
            ) {
                slot.dataset.slotKey  = newKey;
                slot.dataset.statKey  = newStatKey;
                return;
            }

            // Full rebuild required (new card, death, status change, etc.)
            slot.dataset.slotKey      = newKey;
            slot.dataset.structuralKey = newStructKey;
            slot.dataset.statKey       = newStatKey;

            if (unit) {
                const cardDiv = await createCardUI(unit.card, idx, 'board', unit.status);
                slot.innerHTML = '';
                slot.appendChild(cardDiv);
                if (unit.status.justPlayed) {
                    setTimeout(() => { unit.status.justPlayed = false; }, 1000);
                }
            } else {
                slot.innerHTML = '';
            }
        }

        // Convenience: update ATK/HP badges for a single board card without
        // running the full updateBattleUI pass. Falls back to renderBattleSlot
        // if the card element isn't present yet (e.g. slot never rendered).
        async function updateCardStats(side, idx) {
            const slot = document.getElementById(`${side}-slot-${idx}`);
            if (!slot) return;
            const unit = side === 'player' ? state.pBoard[idx] : state.eBoard[idx];
            if (!unit) return;

            const newKey        = _slotKey(unit);
            const newStructKey  = _structuralKey(unit);
            const newStatKey    = _statKey(unit);

            if (slot.dataset.slotKey === newKey) return; // nothing changed

            if (
                slot.dataset.structuralKey === newStructKey &&
                _patchCardStats(slot, unit)
            ) {
                slot.dataset.slotKey = newKey;
                slot.dataset.statKey = newStatKey;
            } else {
                // Structural change — fall back to a full slot render
                await renderBattleSlot(side, idx);
            }
        }

        function allowDrop(e) { 
            e.preventDefault(); 
            e.currentTarget.classList.add('drag-over');
        }

        document.querySelectorAll('.slot').forEach(s => {
            s.ondragleave = (e) => e.currentTarget.classList.remove('drag-over');
        });

        async function dropOnSlot(e) {
            e.preventDefault();
            const side = e.currentTarget.dataset.side;
            const idx = parseInt(e.currentTarget.dataset.idx);
            e.currentTarget.classList.remove('drag-over');

            if(!state.dragging) return;

            if(state.dragging.type === 'hand' && side === 'player') {
                const c = state.hand[state.dragging.index];
                if(state.mana >= c.cost && !state.pBoard[idx]) {
                    state.mana -= c.cost;
                    const cardUnit = {
                        card: cloneCard(c),
                        status: {
                            exhausted: !(c.ability === 'haste' || c.ability === 'haste2'),
                            justPlayed: true,
                            silenced: false
                        }
                    };
                    state.pBoard[idx] = cardUnit;
                    state.hand.splice(state.dragging.index, 1);
                    log(`${c.name.toUpperCase()} DEPLOYED.`);
                    await triggerCardEvent('onPlay', cardUnit, { slot: idx, side: 'player', board: state.pBoard });
                    updateBattleUI();
                }
            } else if(state.dragging.type === 'board' && side === 'enemy') {
                await handleStrike(state.dragging.index, idx);
            }
            state.dragging = null;
        }

        async function handleStrike(pIdx, eIdx) {
            const atk = state.pBoard[pIdx];
            const def = state.eBoard[eIdx];

            if(!atk || !def || atk.status.exhausted) return;

            const guard = state.eBoard.some(u => u && u.card.ability === 'guard');
            if(guard && def.card.ability !== 'guard' && atk.card.ability !== 'snipe') {
                log("GUARD ACTIVE: TARGET BLOCKED.");
                return;
            }

            if(atk.status.silenced) {
                log(`${atk.card.name} is silenced and cannot attack this round.`);
                return;
            }

            const atkEl = getSlotCard('player', pIdx);
            const defEl = getSlotCard('enemy', eIdx);
            const attackerRect = atkEl?.getBoundingClientRect();
            const defenderRect = defEl?.getBoundingClientRect();
            const attackerX = attackerRect?.x ?? 0;
            const attackerY = attackerRect?.y ?? 0;
            const defenderX = defenderRect?.x ?? 0;
            const defenderY = defenderRect?.y ?? 0;
            const slamTargetX = defenderX - attackerX;
            const slamTargetY = defenderY - attackerY;

            atkEl?.style.setProperty('--attacker-x', `${attackerX}px`);
            atkEl?.style.setProperty('--attacker-y', `${attackerY}px`);
            atkEl?.style.setProperty('--defender-x', `${defenderX}px`);
            atkEl?.style.setProperty('--defender-y', `${defenderY}px`);
            atkEl?.style.setProperty('--slam-target-x', `${slamTargetX}px`);
            atkEl?.style.setProperty('--slam-target-y', `${slamTargetY}px`);

            // Physical Slam
            animateCard(atkEl, 'animate-slam-up');
            
            // Impact Flicker (starts 200ms into the slam)
            setTimeout(async () => {
                animateCard(atkEl, 'animate-hit-flicker');
                animateCard(defEl, 'animate-hit-flicker');
            }, 200);

            // Update HP and UI after the visual hit
            setTimeout(async () => {
                if(atk.card.ability === 'heal') {
                    animateCard(document.getElementById('player-hp'), 'animate-heal');
                }

                // Track HP before damage for Berserk calculations
                const preDefHp = def.card.hp;

                await triggerCardEvent('whenAttacked', def, { target: atk, slot: eIdx, side: 'enemy', board: state.eBoard });
                await triggerCardEvent('whenAttacked', atk, { target: def, slot: pIdx, side: 'player', board: state.pBoard });

                // 1. APPLY DAMAGE WITH INVINCIBILITY/SHIELD CHECK
                let actualDamageToDef = atk.card.atk;
                if (def.status && def.status.invincible > 0) {
                    log(`${def.card.name.toUpperCase()} IS INVINCIBLE! NO DAMAGE TAKEN.`);
                    actualDamageToDef = 0;
                } else if (def.status && def.status.shield > 0) {
                    const shieldAbsorbed = Math.min(def.status.shield, atk.card.atk);
                    def.status.shield -= shieldAbsorbed;
                    actualDamageToDef = atk.card.atk - shieldAbsorbed;
                    log(`${def.card.name.toUpperCase()}'S SHIELD ABSORBS ${shieldAbsorbed} DAMAGE! (${def.status.shield} SHIELD REMAINING)`);
                    if (actualDamageToDef > 0) {
                        log(`${def.card.name.toUpperCase()} TAKES ${actualDamageToDef} DAMAGE THROUGH SHIELD.`);
                    }
                }
                
                if (actualDamageToDef > 0) {
                    def.card.hp -= actualDamageToDef;
                }

                // 2. APPLY COUNTER DAMAGE WITH INVINCIBILITY/REFLECT CHECK
                let actualDamageToAtk = def.card.atk;
                if (atk.status && atk.status.invincible > 0) {
                    log(`${atk.card.name.toUpperCase()} IS INVINCIBLE! NO COUNTER DAMAGE.`);
                    actualDamageToAtk = 0;
                } else if (def.status && def.status.reflect > 0) {
                    // Reflect damage back to attacker
                    const reflectDamage = Math.min(def.status.reflect, def.card.atk);
                    actualDamageToAtk = def.card.atk + reflectDamage;
                    log(`${def.card.name.toUpperCase()} REFLECTS ${reflectDamage} DAMAGE BACK TO ${atk.card.name.toUpperCase()}!`);
                }
                
                if (actualDamageToAtk > 0) {
                    atk.card.hp -= actualDamageToAtk;
                }

                // Patch stat badges immediately for surviving combatants
                if (def.card.hp > 0) updateCardStats('enemy', eIdx);
                if (atk.card.hp > 0) updateCardStats('player', pIdx);

                const isHaste2 = atk.card.ability === 'haste2';
                const attackContext = {
                    target: def,
                    targetIdx: eIdx,
                    defenderHp: preDefHp,
                    side: 'player',
                    board: state.pBoard,
                    opponentBoard: state.eBoard
                };

                // 2. HANDLE ABILITIES
                if(atk.card.ability === 'silence') {
                    def.status.silenced = (def.status.silenced || 0) + 1;
                    log(`${def.card.name} is SILENCED.`);
                    animateCard(defEl, 'animate-ability');
                }

                if(atk.card.ability === 'berserk' && def.card.hp <= 0) {
                    const overflow = Math.max(0, atk.card.atk - preDefHp);
                    if(overflow > 0) {
                        state.eHp -= overflow;
                        log(`BERSERK OVERFLOW: ${overflow} DMG TO ENEMY NEXUS`);
                        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    }
                }

                if(atk.card.ability === 'heal') {
                    const healAmount = Math.min(5, Math.ceil(atk.card.atk / 2));
                    state.pHp += healAmount;
                    log(`HEAL: ${healAmount} TO YOUR NEXUS`);
                }

                if(atk.card.ability === 'splash') {
                    [eIdx - 1, eIdx + 1].forEach(adj => {
                        if(state.eBoard[adj]) {
                            state.eBoard[adj].card.hp -= 1;
                            if(state.eBoard[adj].card.hp <= 0) {
                                log(`${state.eBoard[adj].card.name} TAKES SPLASH AND DIES`);
                                animateCardDeath(getSlotCard('enemy', adj), () => { state.eBoard[adj] = null; });
                            } else {
                                log(`${state.eBoard[adj].card.name} TAKES SPLASH`);
                                updateCardStats('enemy', adj);
                            }
                        }
                    });
                    animateCard(defEl, 'animate-ability');
                }

                await triggerCardEvent('onAttack', atk, attackContext);
                
                // --- ON DEATH TRIGGERS ---
                if (def.card.hp <= 0) {
                    await triggerCardEvent('onDeath', def, { slot: eIdx, side: 'enemy', board: state.eBoard, killedBy: atk });
                    if (def.card.hp <= 0) animateCardDeath(defEl, () => { state.eBoard[eIdx] = null; });
                }

                if (atk.card.hp <= 0) {
                    await triggerCardEvent('onDeath', atk, { slot: pIdx, side: 'player', board: state.pBoard, killedBy: def });
                    if (atk.card.hp <= 0) animateCardDeath(atkEl, () => { state.pBoard[pIdx] = null; });
                }

                const isEnergised = atk.status.energised;

                if (!isHaste2 && !isEnergised) {
                    atk.status.exhausted = true;
                } else if ((isHaste2 || isEnergised) && atk.card.hp > 0 && def && def.card.hp > 0) {
                    log(`${atk.card.name} ${isEnergised ? '(ENERGISED)' : '(HASTE2)'} strikes again!`);
                    animateCard(atkEl, 'animate-attack');
                    await handleStrike(pIdx, eIdx);
                    atk.status.exhausted = true;
                } else {
                    atk.status.exhausted = true;
                }


                updateBattleUI();
                checkVictory();
            }, 400);
        }

        async function dropOnNexus(side) {
            if(!state.dragging) return;
            if(state.dragging.type === 'board' && side === 'enemy') {
                const atk = state.pBoard[state.dragging.index];
                const atkEl = getSlotCard('player', state.dragging.index);
                if(!atk || atk.status.exhausted || atk.status.silenced) {
                    if(atk && atk.status.silenced) log(`${atk.card.name} is silenced and cannot strike nexus.`);
                    return;
                }
                if(state.eBoard.some(u => u && u.card.ability === 'guard')) return log("CORE GUARDED.");

                animateCard(atkEl, 'animate-attack');
                state.eHp -= atk.card.atk;
                animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                await triggerCardEvent('onAttack', atk, {
                    target: 'enemyNexus',
                    side: 'player',
                    board: state.pBoard,
                    opponentBoard: state.eBoard
                });

                if(atk.card.ability === 'heal') {
                    const healAmount = Math.max(1, Math.floor(atk.card.atk / 2));
                    state.pHp = Math.min(30, state.pHp + healAmount);
                    log(`HEAL: +${healAmount} to your nexus.`);
                    animateCard(document.getElementById('player-hp'), 'animate-heal');
                }

                if(atk.card.ability === 'berserk') {
                    // No additional overflow needed, direct strike already does max damage.
                }

                if(atk.card.ability === 'haste2') {
                    state.eHp -= atk.card.atk;
                    log(`HASTE2 BONUS: additional ${atk.card.atk} DMG to nexus.`);
                    animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                }

                atk.status.exhausted = true;
                log(`DIRECT STRIKE: ${atk.card.atk} DMG.`);
                updateBattleUI();
                checkVictory();
            }
            state.dragging = null;
        }

        async function endTurn() {
            // 1. Trigger End of Turn effects
            for (const group of [
                { side: 'player', board: state.pBoard },
                { side: 'enemy', board: state.eBoard }
            ]) {
                for (let idx = 0; idx < group.board.length; idx++) {
                    const unit = group.board[idx];
                    if (unit) {
                        // Everyone triggers standard end-of-turn effects
                        await triggerCardEvent('onTurnEnd', unit, { side: group.side, slot: idx, board: group.board });
                        
                        // ONLY check Player units for missed attacks here
                        if (group.side === 'player' && unit.status.exhausted === false) {
                            await triggerCardEvent('whenNotAttack', unit, { side: group.side, slot: idx, board: group.board });
                            log(`${unit.card.name.toUpperCase()} DID NOT ATTACK, TRIGGERING ABILITY!`);
                        }
                    }
                }
            }

            updateBattleUI();
            log("ENEMY CYCLE STARTING...");
            
            const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);

            setTimeout(async () => {
                // 2. AI plays a card with difficulty-based rarity filtering
                const slot = state.eBoard.findIndex(s => s === null);
                if(slot !== -1) {
                    // Filter cards by difficulty rarity
                    const diffLevel = window.selectedDifficulty || 1;
                    const rarityOrder = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
                    const maxRarityIndex = Math.min(Math.max(0, diffLevel - 1), 4);
                    const minRarityIndex = Math.max(0, diffLevel - 3);
                    
                    // Filter by rarity range based on difficulty
                    const filteredCards = collectibleCards.filter(c => {
                        const rarityIdx = rarityOrder.indexOf(c.rarity);
                        return rarityIdx >= 0 && rarityIdx >= minRarityIndex && rarityIdx <= maxRarityIndex;
                    });
                    
                    // Fall back to all cards if no cards match criteria
                    const cardPool = filteredCards.length > 0 ? filteredCards : collectibleCards;
                    const c = cardPool[Math.floor(Math.random() * cardPool.length)];
                    const enemyUnit = { card: cloneCard(c), status: { exhausted: true, justPlayed: true, silenced: false } };
                    state.eBoard[slot] = enemyUnit;
                    await triggerCardEvent('onPlay', enemyUnit, { slot, side: 'enemy', board: state.eBoard });
                }

                // 3. AI Attacks
                state.eBoard.forEach(async (u, enemyIdx) => {
                    if(u && !u.status.exhausted && !u.status.silenced) {
                        
                        // Helper to handle the AI's targeting and striking logic
                        const performAIStrike = async () => {
                            // 1. Determine Target
                            let targetType = 'nexus';
                            let targetIdx = -1;
                            
                            const guardIndex = state.pBoard.findIndex(v => v && v.card.ability === 'guard');
                            
                            if (guardIndex !== -1) {
                                // Must attack guard if one is present
                                targetType = 'unit';
                                targetIdx = guardIndex;
                            } else {
                                // Randomly choose between player's units and the Nexus (excluding invisible units)
                                const validTargets = [{ type: 'nexus' }];
                                state.pBoard.forEach((pUnit, idx) => {
                                    if (pUnit && (!pUnit.status || !pUnit.status.invisible || pUnit.status.invisible <= 0)) {
                                        validTargets.push({ type: 'unit', idx: idx });
                                    }
                                });
                                
                                const chosen = validTargets[Math.floor(Math.random() * validTargets.length)];
                                targetType = chosen.type;
                                targetIdx = chosen.idx;
                            }

                            // 2. Execute Strike
                            if (targetType === 'nexus') {
                                // Check charmedBy — if target is the nexus, no charm applies
                                state.pHp -= u.card.atk;
                                log(`${u.card.name} hits your nexus for ${u.card.atk}.`);
                            } else {
                                const targetUnit = state.pBoard[targetIdx];

                                // HINA — SOUL CHARM: Skip if this enemy is charmed and targeting Hina
                                if (u.status?.charmedBy && targetUnit?.card?.name === u.status.charmedBy) {
                                    log(`${u.card.name} is CHARMED — cannot strike ${u.status.charmedBy}! Attack cancelled.`);
                                    u.status.exhausted = true;
                                    return;
                                }

                                const preDefHp = targetUnit.card.hp; // Saved for accurate berserk calculations
                                
                                await triggerCardEvent('whenAttacked', targetUnit, { target: u, slot: targetIdx, side: 'player', board: state.pBoard });
                                await triggerCardEvent('whenAttacked', u, { target: targetUnit, slot: enemyIdx, side: 'enemy', board: state.eBoard });

                                // AI damages Player Unit (with shield/reflect checks)
                                let actualDamageToTarget = u.card.atk;
                                if (targetUnit.status && targetUnit.status.invincible > 0) {
                                    log(`INVINCIBLE: ${targetUnit.card.name} blocked the hit!`);
                                    actualDamageToTarget = 0;
                                } else if (targetUnit.status && targetUnit.status.shield > 0) {
                                    const shieldAbsorbed = Math.min(targetUnit.status.shield, u.card.atk);
                                    targetUnit.status.shield -= shieldAbsorbed;
                                    actualDamageToTarget = u.card.atk - shieldAbsorbed;
                                    log(`${targetUnit.card.name.toUpperCase()}'S SHIELD ABSORBS ${shieldAbsorbed} DAMAGE! (${targetUnit.status.shield} SHIELD REMAINING)`);
                                    if (actualDamageToTarget > 0) {
                                        log(`${targetUnit.card.name} takes ${actualDamageToTarget} damage through shield.`);
                                    }
                                }
                                
                                if (actualDamageToTarget > 0) {
                                    targetUnit.card.hp -= actualDamageToTarget;
                                    log(`${u.card.name} hits ${targetUnit.card.name} for ${actualDamageToTarget}.`);
                                } else if (actualDamageToTarget === 0 && !(targetUnit.status && targetUnit.status.invincible > 0)) {
                                    log(`${u.card.name} hits ${targetUnit.card.name} but shield blocks all damage.`);
                                }
                                
                                // Player Unit damages AI Unit (Fair counter-attack with reflect)
                                let actualDamageToAI = targetUnit.card.atk;
                                if (u.status && u.status.invincible > 0) {
                                    log(`INVINCIBLE: ${u.card.name} takes no counter damage!`);
                                    actualDamageToAI = 0;
                                } else if (targetUnit.status && targetUnit.status.reflect > 0) {
                                    // Reflect damage back to AI
                                    const reflectDamage = Math.min(targetUnit.status.reflect, targetUnit.card.atk);
                                    actualDamageToAI = targetUnit.card.atk + reflectDamage;
                                    log(`${targetUnit.card.name.toUpperCase()} REFLECTS ${reflectDamage} DAMAGE BACK TO ${u.card.name.toUpperCase()}!`);
                                }
                                
                                if (actualDamageToAI > 0) {
                                    u.card.hp -= actualDamageToAI;
                                }

                                // Patch stat badges immediately for surviving combatants
                                if (targetUnit.card.hp > 0) updateCardStats('player', targetIdx);
                                if (u.card.hp > 0) updateCardStats('enemy', enemyIdx);

                                // Resolve Player Unit Death
                                if (targetUnit.card.hp <= 0) {
                                    log(`${targetUnit.card.name} is destroyed.`);
                                    await triggerCardEvent('onDeath', targetUnit, { slot: targetIdx, side: 'player', board: state.pBoard });
                                    
                                    if (targetUnit.card.hp <= 0) {
                                        animateCardDeath(getSlotCard('player', targetIdx), () => { state.pBoard[targetIdx] = null; });
                                    }
                                    
                                    if (u.card.ability === 'berserk') {
                                        const overflow = Math.max(0, u.card.atk - preDefHp);
                                        if (overflow > 0) {
                                            state.pHp -= overflow;
                                            log(`BERSERK OVERFLOW: ${overflow} damage to nexus.`);
                                        }
                                    }
                                }
                                
                                // Resolve AI Unit Death (If it died to counter-damage)
                                if (u.card.hp <= 0) {
                                    await triggerCardEvent('onDeath', u, { slot: enemyIdx, side: 'enemy', board: state.eBoard });
                                    if (u.card.hp <= 0) animateCardDeath(getSlotCard('enemy', enemyIdx), () => { state.eBoard[enemyIdx] = null; });
                                }
                            }
                        };

                        // Execute the primary attack
                        await performAIStrike();

                        const isEnergised = u.status.energised;
                        const isHaste2 = u.card.ability === 'haste2';

                        if (!isHaste2 && !isEnergised) {
                            u.status.exhausted = true;
                        } else if ((isHaste2 || isEnergised) && u.card.hp > 0) {
                            log(`${u.card.name} ${isEnergised ? '(ENERGISED)' : '(HASTE2)'} strikes again!`);
                            animateCard(getSlotCard('enemy', enemyIdx), 'animate-attack');
                            u.status.exhausted = true;
                        }
                    }
            }
            );

                    // Reset enemy statuses and decrement temporary effects
                if (u) { {
                        if (u.status.invincible > 0) u.status.invincible--;
                        if (u.status.shield > 0) u.status.shield--;
                        if (u.status.reflect > 0) u.status.reflect--;
                        if (u.status.invisible > 0) u.status.invisible--;
                        u.status.exhausted = false;
                        if (u.status.silenced > 0) u.status.silenced--;
                        u.status.justPlayed = false;
                    }
                };
                
                // 4. Resource Refresh
                if(state.maxMana < 10) state.maxMana++;
                state.mana = state.maxMana;

                // 5. Reset player statuses and decrement temporary effects
                state.pBoard.forEach(u => { 
                    if(u) { 
                        if (u.status.invincible > 0) u.status.invincible--;
                        if (u.status.shield > 0) u.status.shield--;
                        if (u.status.reflect > 0) u.status.reflect--;
                        if (u.status.invisible > 0) u.status.invisible--;
                        u.status.exhausted = false; 
                        u.status.justPlayed = false; 
                        if (u.status.silenced > 0) u.status.silenced--;
                        // Clear Hina's charm mark each turn
                        if (u.status.charmedBy) delete u.status.charmedBy;
                        // Clear Maria Hunley's per-turn heal tracker
                        if (u.status._mariaHealedThisTurn) u.status._mariaHealedThisTurn.clear();
                    } 
                });
                // Also clear charm on enemy units
                state.eBoard.forEach(u => {
                    if (u && u.status?.charmedBy) delete u.status.charmedBy;
                });

                // 6. Trigger OnTurnStart effects
                for (const group of [
                    { side: 'player', board: state.pBoard },
                    { side: 'enemy', board: state.eBoard }
                ]) {
                    for (let idx = 0; idx < group.board.length; idx++) {
                        const unit = group.board[idx];
                        if (unit) {
                            await triggerCardEvent('onTurnStart', unit, { side: group.side, slot: idx, board: group.board });
                        }
                    }
                };
                updateBattleUI();
                checkVictory();
            }, 500);

        function checkVictory() {
            if (state.pHp <= 0) {
                log("ENEMY VICTORY!");
                // TODO: Show victory screen for enemy
            } else if (state.eHp <= 0) {
                log("PLAYER VICTORY!");
                // TODO: Show victory screen for player
            }
        }
    }

        // ══════════════════════════════════════════════════════════════════════════
        // OWNED CARDS — single source of truth: localStorage key 'ownedCards'
        // All screens (lobby, my collection, library) read from this same place.
        // ══════════════════════════════════════════════════════════════════════════

        /** Returns a Set of card names the player currently owns. */
        function getOwnedCardNames() {
            if (typeof playerData !== 'undefined' && playerData && playerData.collection)
                return new Set(playerData.collection.filter(c => c.count > 0).map(c => c.name));
            try { return new Set(JSON.parse(localStorage.getItem('ownedCards') || '[]')); }
            catch (_) { return new Set(); }
        }

        /** Returns a Map of cardName → count for all owned cards. */
        function getOwnedCardCounts() {
            if (typeof playerData !== 'undefined' && playerData && playerData.collection)
                return new Map(playerData.collection.filter(c => c.count > 0).map(c => [c.name, c.count]));
            try {
                const arr = JSON.parse(localStorage.getItem('ownedCards') || '[]');
                const map = new Map();
                for (const name of arr) map.set(name, (map.get(name) || 0) + 1);
                return map;
            } catch (_) { return new Map(); }
        }

        /** Add or remove a card from the owned set, then refresh all affected UI. */
        function markCardOwned(cardName, owned) {
            let s = getOwnedCardNames();
            if (owned) s.add(cardName); else s.delete(cardName);
            localStorage.setItem('ownedCards', JSON.stringify([...s]));
            updateLobbyStats();
            // Refresh whichever screen is visible
            if (state.activeScreen === 'library')    renderLibrary();
            if (state.activeScreen === 'collection') renderCollection();
        }

        // ── Lobby stats ───────────────────────────────────────────────────────────
        function updateLobbyStats() {
            const collectible = (ALL_CHARS || []).filter(c => !c.isKeyCard);
            const owned = getOwnedCardNames();
            const count = collectible.filter(c => owned.has(c.name)).length;
            const el = document.getElementById('lobby-collection-count');
            if (el) el.textContent = count;
        }

        // ── My Collection screen ──────────────────────────────────────────────────
        let _collectionRarity = 'ALL';
        let _collectionView   = 'owned'; // 'owned' | 'all'

        /** Called by the All / Owned toggle buttons on the My Collection screen. */
        function setCollectionOwned(view, btn) {
            _collectionView = view || 'owned';
            document.querySelectorAll('#collection-toggle .collection-filter-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            renderCollection();
        }

        /** Called by the rarity pills on the My Collection screen. */
        function setCollectionFilter(rarity, btn) {
            _collectionRarity = (rarity || 'ALL').toUpperCase();
            document.querySelectorAll('#collection-rarity-filters .collection-filter-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            renderCollection();
        }

        /** Render the My Collection grid. */
        async function renderCollection() {
            const grid = document.getElementById('collection-grid');
            if (!grid) return;

            if (!ALL_CHARS || !ALL_CHARS.length) {
                grid.innerHTML = '<p class="text-white/40 text-center p-8 col-span-full">Loading cards…</p>';
                return;
            }

            const owned       = getOwnedCardNames();
            const searchQuery = (document.getElementById('collection-search')?.value || '').toLowerCase().trim();
            const collectible = ALL_CHARS.filter(c => !c.isKeyCard);

            // Update count label
            const totalOwned = collectible.filter(c => owned.has(c.name)).length;
            const label = document.getElementById('collection-count-label');
            if (label) label.textContent = `${totalOwned} / ${collectible.length} cards owned`;

            // Filter
            const cards = collectible.filter(c => {
                if (_collectionView === 'owned' && !owned.has(c.name)) return false;
                if (_collectionRarity !== 'ALL' && (c.rarity || '').toUpperCase() !== _collectionRarity) return false;
                if (searchQuery && !c.name.toLowerCase().includes(searchQuery) &&
                    !(c.series || '').toLowerCase().includes(searchQuery)) return false;
                return true;
            });

            grid.innerHTML = '';
            if (!cards.length) {
                grid.innerHTML = '<p class="text-white/40 text-center p-8 col-span-full">No cards match your filters.</p>';
                return;
            }

            for (const card of cards) {
                const isOwned = owned.has(card.name);
                const safeFB  = (card.imageFallback || '').replace(/'/g, "\\'");
                const div = document.createElement('div');
                div.className = 'collection-card-wrap';
                div.innerHTML = `
                    <div class="card-nexus card-vault rarity-${(card.rarity||'common').toLowerCase()} ${isOwned ? '' : 'opacity-40 grayscale'}">
                        <div class="cost-badge">${card.cost ?? '?'}</div>
                        <div class="rarity-badge">${card.rarity || ''}</div>
                        ${card.rank ? `<div class="rank-badge rank-${card.rank.toUpperCase()}">${card.rank.toUpperCase()}</div>` : ''}
                        <div class="card-title-container flex-1 flex flex-col items-center pointer-events-none">
                            <img src="${card.image}" onerror="cardImageFallback(this,'${card.name.replace(/'/g, "\\'")}')" crossorigin="anonymous" alt="${card.name}">
                            <div class="text-[9px] font-black leading-tight uppercase px-1 text-center">${card.name}</div>
                        </div>
                        <div class="description-box" style="font-size:7px;padding:4px 6px;overflow:hidden;max-height:60px;opacity:0.8">
                            ${(card.description||'').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>').substring(0,120)}
                        </div>
                        <div class="stat-badge atk-badge">${card.atk ?? '?'}</div>
                        <div class="stat-badge hp-badge">${card.hp ?? '?'}</div>
                    </div>
                    ${isOwned ? '<div class="collection-owned-tick">✓</div>' : ''}`;
                grid.appendChild(div);
            }

            // Also keep lobby in sync
            updateLobbyStats();
        }

        // ── Library screen ────────────────────────────────────────────────────────
        let _libraryViewMode = 'all';   // 'all' | 'owned' | 'missing'
        let _libraryRarity   = 'ALL';

        function setLibraryView(mode, btn) {
            _libraryViewMode = mode || 'all';
            document.querySelectorAll('.lib-view-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            renderLibrary();
        }

        function setLibraryFilter(rarity, btn) {
            _libraryRarity = (rarity || 'ALL').toUpperCase();
            document.querySelectorAll('.lib-rarity-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            renderLibrary();
        }

        // ── Series Banner System ──────────────────────────────────────────────────
        // Since the 'banners' bucket is public, we construct URLs directly from the
        // series name. No API listing needed — onerror on the img hides it if missing.
        const BANNER_BUCKET = 'banners';

        const BANNER_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

        function slugify(str) {
            return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }

        function toStorageName(str) {
            // Normalize unicode (ā → a), strip non-alphanumeric/space chars, then underscore-join
            const normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip diacritics
            return normalized.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        }

        // No API call needed — bucket is public, URLs are constructed directly.
        // The rendered <img> uses onerror to try fallback extensions, then hides itself.
        async function loadBanners() { /* no-op */ }

        function getBannerCandidateUrls(series) {
            const clean      = toStorageName(series);   // atarashi_gakko_secret_garden
            const slug       = slugify(series);          // atarashi-gakko-secret-garden (legacy)
            const base       = `${SUPABASE_URL}/storage/v1/object/public/${BANNER_BUCKET}`;
            const urls = [];
            for (const ext of BANNER_EXTS) urls.push(`${base}/${clean}.${ext}`);
            for (const ext of BANNER_EXTS) urls.push(`${base}/${slug}.${ext}`);
            return urls;
        }

        async function renderLibrary() {
            const content   = document.getElementById('library-content');
            const seriesNav = document.getElementById('lib-series-nav');
            if (!content) return;

            if (!ALL_CHARS || !ALL_CHARS.length) {
                content.innerHTML = `<div class="lib-empty-state"><div class="lib-empty-icon">📦</div><div class="lib-empty-title">Loading cards…</div></div>`;
                return;
            }

            const owned       = getOwnedCardNames();
            const ownedCounts = getOwnedCardCounts();
            const searchQuery = (document.getElementById('library-search')?.value || '').toLowerCase().trim();
            const collectible = ALL_CHARS.filter(c => !c.isKeyCard);

            // ── Stat counters & progress bar ──────────────────────────────────────
            const totalCount   = collectible.length;
            const ownedCount   = collectible.filter(c => owned.has(c.name)).length;
            const missingCount = totalCount - ownedCount;
            const pct          = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;

            const $ = id => document.getElementById(id);
            if ($('lib-owned-count'))   $('lib-owned-count').textContent   = ownedCount;
            if ($('lib-missing-count')) $('lib-missing-count').textContent = missingCount;
            if ($('lib-total-count'))   $('lib-total-count').textContent   = totalCount;
            if ($('lib-pct-count'))     $('lib-pct-count').textContent     = pct + '%';
            if ($('lib-global-bar'))    $('lib-global-bar').style.width    = pct + '%';

            const RARITY_COLOR = { COMMON:'#475569', UNCOMMON:'#059669', RARE:'#2563eb', EPIC:'#9333ea', LEGENDARY:'#d97706' };
            const RARITY_ICON  = { COMMON:'◆', UNCOMMON:'◆◆', RARE:'◆◆◆', EPIC:'◈', LEGENDARY:'★' };

            // ── Filter ────────────────────────────────────────────────────────────
            const filtered = collectible.filter(c => {
                if (_libraryViewMode === 'owned'   && !owned.has(c.name)) return false;
                if (_libraryViewMode === 'missing' &&  owned.has(c.name)) return false;
                if (_libraryRarity !== 'ALL' && (c.rarity || '').toUpperCase() !== _libraryRarity) return false;
                if (searchQuery && !c.name.toLowerCase().includes(searchQuery) &&
                    !(c.series || '').toLowerCase().includes(searchQuery)) return false;
                return true;
            });

            // ── Group by series ───────────────────────────────────────────────────
            const seriesMap = new Map();
            for (const c of collectible) {
                const s = c.series || 'Uncategorised';
                if (!seriesMap.has(s)) seriesMap.set(s, { all: [], shown: [] });
                seriesMap.get(s).all.push(c);
            }
            for (const c of filtered) {
                const s = c.series || 'Uncategorised';
                seriesMap.get(s).shown.push(c);
            }

            // ── Series nav ────────────────────────────────────────────────────────
            if (seriesNav) {
                seriesNav.innerHTML = '';
                for (const [series, { all }] of seriesMap) {
                    if (!all.length) continue;
                    const ownedInSeries = all.filter(c => owned.has(c.name)).length;
                    const complete      = ownedInSeries === all.length;
                    const anchor        = 'lib-series-' + series.replace(/\s+/g, '-');
                    const pill = document.createElement('button');
                    pill.className = 'lib-series-pill' + (complete ? ' complete' : '');
                    pill.innerHTML = `${series} <span class="lib-series-pill-count">${ownedInSeries}/${all.length}</span>`;
                    pill.onclick = () => { const t = document.getElementById(anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
                    seriesNav.appendChild(pill);
                }
            }

            // ── Render content ────────────────────────────────────────────────────
            content.innerHTML = '';
            const hasAny = [...seriesMap.values()].some(v => v.shown.length > 0);
            if (!hasAny) {
                content.innerHTML = `<div class="lib-empty-state"><div class="lib-empty-icon">🔍</div><div class="lib-empty-title">No cards found</div><div class="lib-empty-sub">Try adjusting your filters or search</div></div>`;
                return;
            }

            for (const [series, { all, shown }] of seriesMap) {
                if (!shown.length) continue;
                const anchor        = 'lib-series-' + series.replace(/\s+/g, '-');
                const ownedInSeries = all.filter(c => owned.has(c.name)).length;
                const complete      = ownedInSeries === all.length;
                const pctSeries     = all.length > 0 ? Math.round((ownedInSeries / all.length) * 100) : 0;

                const section = document.createElement('div');
                section.className = 'lib-series-section';
                section.id = anchor;

                const bannerCandidates = getBannerCandidateUrls(series);
                const bannerDataAttr   = bannerCandidates.map(u => encodeURIComponent(u)).join(',');
                const badgeHtml = complete
                    ? '<span class="lib-complete-badge">✦ Complete</span>'
                    : `<span class="lib-missing-badge">${all.length - ownedInSeries} missing</span>`;

                // Build a self-healing banner: inject all candidate URLs as hidden imgs.
                // The first one that loads applies the background; others are ignored.
                const firstUrl = bannerCandidates[0];
                const sectionId = anchor;

                section.innerHTML = `
                    <div class="lib-series-banner lib-series-banner--pending"
                         id="banner-wrap-${sectionId}"
                         style="background-image:url('${firstUrl}')">
                        <div class="lib-series-banner-overlay"></div>
                        <div class="lib-series-banner-content">
                            <span class="lib-series-name lib-series-name--banner">${series}</span>
                            <span class="lib-series-badge">${badgeHtml}</span>
                        </div>
                    </div>
                    <div class="lib-series-progress-wrap lib-series-progress-wrap--below" id="banner-prog-${sectionId}">
                        <div class="lib-series-progress-bar" style="width:${pctSeries}%"></div>
                    </div>
                    <div class="lib-cards-grid"></div>`;

                // Probe candidates in order; on first success apply it, on total failure revert to plain header
                (function probeBanners(urls) {
                    if (!urls.length) {
                        // No banner found — revert to plain header
                        const bw = document.getElementById('banner-wrap-' + sectionId);
                        const bp = document.getElementById('banner-prog-' + sectionId);
                        if (bw) bw.outerHTML = `
                            <div class="lib-series-header">
                                <div class="lib-series-header-left">
                                    <span class="lib-series-name">${series}</span>
                                    <span class="lib-series-badge">${badgeHtml}</span>
                                </div>
                                <div class="lib-series-progress-wrap">
                                    <div class="lib-series-progress-bar" style="width:${pctSeries}%"></div>
                                </div>
                            </div>`;
                        if (bp) bp.remove();
                        return;
                    }
                    const url = urls.shift();
                    const img = new Image();
                    img.onload = () => {
                        const bw = document.getElementById('banner-wrap-' + sectionId);
                        if (bw) {
                            bw.style.backgroundImage = `url('${url}')`;
                            bw.classList.remove('lib-series-banner--pending');
                        }
                    };
                    img.onerror = () => probeBanners(urls);
                    img.src = url;
                })(bannerCandidates.slice());

                const grid = section.querySelector('.lib-cards-grid');

                for (const card of shown) {
                    const isOwned    = owned.has(card.name);
                    const rarityKey  = (card.rarity || 'COMMON').toUpperCase();
                    const rarityColor = RARITY_COLOR[rarityKey] || '#475569';
                    const safeFB     = (card.imageFallback || '').replace(/'/g, "\\'");

                    if (isOwned) {
                        const wrap = document.createElement('div');
                        wrap.className = 'lib-card-owned-wrap';
                        const countBadge = document.createElement('span');
                        countBadge.className = 'lib-count-badge';
                        countBadge.textContent = `✦ ×${ownedCounts.get(card.name) || 1}`;
                        wrap.appendChild(countBadge);
                        const cardDiv = await createCardUI(card, 0, 'preview', {}, true);
                        wrap.appendChild(cardDiv);
                        grid.appendChild(wrap);
                    } else {
                        const miss = document.createElement('div');
                        miss.className = 'lib-missing-card';
                        miss.style.setProperty('--rarity-color', rarityColor);
                        miss.innerHTML = `
                            <div class="lib-missing-inner">
                                <div class="lib-missing-icon">${RARITY_ICON[rarityKey] || '?'}</div>
                                <div class="lib-missing-name">${card.name}</div>
                                <div class="lib-missing-rarity">${card.rarity || ''}</div>
                            </div>`;
                        grid.appendChild(miss);
                    }
                }
                content.appendChild(section);
            }
        }

        // ── Bootstrap ────────────────────────────────────────────────────────────
        window.addEventListener('DOMContentLoaded', async () => {
            await Promise.all([loadCards(), loadBanners()]);
            updateLobbyStats();
            showScreen('story'); // Default to story mode for visual novel experience
            if (typeof renderVault === 'function') {
                const vaultScreen = document.getElementById('screen-vault');
                if (vaultScreen && !vaultScreen.classList.contains('hidden-screen')) renderVault();
            }
        });