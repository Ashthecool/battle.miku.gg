lucide.createIcons();

        // ── Supabase config ──────────────────────────────────────────────────────
        const SUPABASE_URL    = 'https://djknvuaivmtudiecwztx.supabase.co';
        const SUPABASE_KEY    = 'sb_publishable_oKPY6OIcovoVQlLZqBOLMg_skAxeCwp';
        const SUPABASE_BUCKET = 'card-images';

        function supabaseStorageUrl(path) {
            return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${path}`;
        }

        // Returns the .png URL directly — no async HEAD check needed.
        // img tags use onerror to fall back to .jpg if .png is missing.
        function getCardImage(name) {
            const base = name.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            return supabaseStorageUrl(`${base}.png`);
        }

        function getCardImageJpg(name) {
            const base = name.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            return supabaseStorageUrl(`${base}.jpg`);
        }

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
                    const success = (scenario.type === 'and' || scenario.type === 'all' || scenario.type === 'or') 
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
                    state.pHp = Math.min(30, state.pHp + amount);
                    log(`${card.name.toUpperCase()} HEALS YOUR NEXUS FOR ${amount}.`);
                    animateCard(document.getElementById('player-hp'), 'animate-heal');
                    break;
                case 'berserkOverflow':
                    const overflow = Math.max(0, amount);
                    if (overflow > 0) {
                        state.eHp -= overflow;
                        log(`BERSERK OVERFLOW: ${overflow} DMG TO ENEMY NEXUS`);
                        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    }
                    break;
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
                    animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    break;
                case 'silenceTarget':
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
                case 'disableTarget':
                    if (context.target) {
                        context.target.status.exhausted = true;
                        log(`${context.target.card.name.toUpperCase()} IS DISABLED.`);
                        if (context.targetIdx !== undefined) animateCard(getSlotCard('enemy', context.targetIdx), 'animate-ability');
                    }
                    break;
                case 'drawCard':
                    for (let i = 0; i < Math.max(1, amount); i++) draw();
                    log(`${card.name.toUpperCase()} DRAWS ${Math.max(1, amount)} CARD(S).`);
                    break;
                case 'healSelf':
                    const healed = Math.min(unit.card.maxHp, unit.card.hp + amount) - unit.card.hp;
                    if (healed > 0) {
                        unit.card.hp += healed;
                        log(`${card.name.toUpperCase()} HEALS THEMSELF FOR ${healed}.`);
                        if (context.side !== undefined && context.slot !== undefined) {
                            animateCard(getSlotCard(context.side, context.slot), 'animate-heal');
                        }
                    }
                    break;
                case 'attackUpSelf':
                    unit.card.atk += amount;
                    log(`${card.name.toUpperCase()} ATTACK INCREASED BY ${amount}.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                    
                case 'snipeDamage':
                    if (context.target && context.target.card) {
                        context.target.card.hp -= amount;
                        log(`${card.name.toUpperCase()} SNIPES ${context.target.card.name.toUpperCase()} FOR ${amount} DAMAGE.`);
                    }
                    break;
                case 'healAllies':
                    for (let i = 0; i < context.board.length; i++) {
                        if (context.board[i] && context.board[i].card) {
                            context.board[i].card.hp += amount;
                            log(`${context.board[i].card.name.toUpperCase()} HEALS FOR ${amount}.`);
                        }
                    }
                    break;
                case 'dealDamageAllEnemies':
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
                            }
                        }
                    }
                    break;
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
                    }
                    break;
                }
                case 'hpUpSelf':
                    unit.card.maxHp += amount; // Raise the ceiling
                    unit.card.hp += amount;    // Add the health
                    log(`${card.name.toUpperCase()} GAINS +${amount} MAX HP.`);
                    if (context.side !== undefined && context.slot !== undefined) {
                        animateCard(getSlotCard(context.side, context.slot), 'animate-heal');
                    }
                    break;
                
                case 'discountHandBySeries': 
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
                    
                case 'valuePerSeriesInEnemyBoard':
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

                case 'spawnCard':
                    if (context.side === 'enemy') {
                        log(`${card.name.toUpperCase()} triggered a spawn, but enemies don't hold cards!`);
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
                case 'spawnOnBoard':
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
                case 'giveAllAlliesEffect':
                    // Identify the acting side's board
                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);
                    for (const [idx, u] of allies.entries()) {
                        if (u && u.card) {
                            // Recursively apply the nested effect to every unit on this board
                            await applyCardEffect(effect.effect, u, { ...context, slot: idx, board: allies });
                        }
                    }
                    break;

                case 'giveAllEnemiesEffect':
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
                                break;
                            case 'hpUp':
                                targetUnit.card.maxHp += effectValue;
                                targetUnit.card.hp += effectValue;
                                log(`${card.name.toUpperCase()} GRANTS ${targetUnit.card.name.toUpperCase()} +${effectValue} MAX HP!`);
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

                case 'nexusHpToPowerUp':
                    const hpCost = amount; // The amount of Nexus HP to extract
                    const atkBonus = effect.atkGain || 0;
                    const hpBonus = effect.hpGain || 0;
                    const targetNexus = effect.target || 'player'; // Which Nexus to extract from

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
                    }
                    break;
                
                case 'applyInvincible':
                        // Initialize status if it doesn't exist, then add rounds
                        unit.status.invincible = (unit.status.invincible || 0) + amount;
                        log(`${unit.card.name.toUpperCase()} is now INVINCIBLE for ${amount} rounds!`);
                        break;
                case 'curseAllEnemies': {
                    const cursedBoard = getOpposingBoard(context) || [];
                    for (let i = 0; i < cursedBoard.length; i++) {
                        const target = cursedBoard[i];
                        if (!target || !target.card) continue;

                        target.card.maxHp = Math.max(1, target.card.maxHp - amount);
                        target.card.hp = Math.min(target.card.hp, target.card.maxHp);
                        log(`${target.card.name.toUpperCase()} LOSES ${amount} MAX HP.`);

                        if (target.card.hp <= 0) {
                            await resolveBoardUnitDeath(target, cursedBoard, i);
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
                        }
                    }
                    break;
                case "gainMana":
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
                        if (context.side !== undefined && context.slot !== undefined)
                            animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
                    }
                    break;
                }

                case 'stealAttackFromAll': {
                    // Drains ATK from every enemy and stacks it all onto self.
                    const stealBoard = getOpposingBoard(context);
                    let totalStolen = 0;
                    stealBoard.forEach(u => {
                        if (u && u.card && u.card.atk > 0) {
                            const stolen = Math.min(amount, u.card.atk);
                            u.card.atk  -= stolen;
                            totalStolen += stolen;
                        }
                    });
                    if (totalStolen > 0) {
                        unit.card.atk += totalStolen;
                        log(`${card.name.toUpperCase()} DRAINS ${totalStolen} ATK FROM ALL ENEMIES - NOW AT ${unit.card.atk} ATK.`);
                        if (context.side !== undefined && context.slot !== undefined)
                            animateCard(getSlotCard(context.side, context.slot), 'animate-ability');
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

                    const applyRoll = (u, slotIdx) => {
                        let best = 0;
                        const rolls = [];
                        for (let r = 0; r < tries; r++) {
                            const roll = Math.floor(Math.random() * (max - min + 1)) + min;
                            rolls.push(roll);
                            if (roll > best) best = roll;
                        }

                        const el = getSlotCard(context.side, slotIdx);
                        sleep("100ms")
                        spawnRollPopup(el, rolls, best, stat);

                        if (stat === 'hp') {
                            u.card.maxHp += best;
                            u.card.hp    += best;
                            console.log(`${u.card.name.toUpperCase()} ROLLED [${rolls.join(', ')}] → BEST: +${best} MAX HP.`);
                            animateCard(getSlotCard(context.side, slotIdx), 'animate-heal');
                        } else {
                            u.card.atk += best;
                            console.log(`${u.card.name.toUpperCase()} ROLLED [${rolls.join(', ')}] → BEST: +${best} ATK.`);
                            animateCard(getSlotCard(context.side, slotIdx), 'animate-ability');
                        }
                    };

                    const allies = context.board || (context.side === 'enemy' ? state.eBoard : state.pBoard);

                    if (target === 'allAllies') {
                        allies.forEach((u, i) => { if (u && u.card) applyRoll(u, i); });
                    } else if (target === 'randomAlly') {
                        const alive = allies.map((u, i) => u ? { u, i } : null).filter(Boolean);
                        if (alive.length > 0) {
                            const pick = alive[Math.floor(Math.random() * alive.length)];
                            applyRoll(pick.u, pick.i);
                        }
                    } else {
                        // self (default)
                        applyRoll(unit, context.slot);
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
                    const drain = Math.min(amount, state.maxMana - 1); // never below 1
                    if (drain > 0) {
                        state.maxMana -= drain;
                        log(`${card.name.toUpperCase()} DRAINED ${drain} MANA FROM THE FIELD! MAX IS NOW ${state.maxMana}.`);
                        animateCard(document.getElementById('mana-text'), 'animate-ability');
                    }
                    break;
                }
                case 'manaSteal': {
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
                    break;
                }

                case 'lowerSpecificEnemysAttack': {
                    // Lowers ATK from the specific targeted enemy.
                    if (context.target && context.target.card) {
                        const lowered = Math.min(amount, context.target.card.atk);
                        context.target.card.atk -= lowered;
                        log(`${card.name.toUpperCase()} LOWERS ${context.target.card.name.toUpperCase()}'S ATTACK BY ${lowered}! (NOW ${context.target.card.atk} ATK)`);
                    }
                    break;
                }

                case 'lowerAllEnemiesAttack': {
                    // Lowers ATK from all enemies.
                    const enemyBoard = getOpposingBoard(context) || [];
                    let totalLowered = 0;
                    for (let i = 0; i < enemyBoard.length; i++) {
                        const target = enemyBoard[i];
                        if (target && target.card && target.card.atk > 0) {
                            const lowered = Math.min(amount, target.card.atk);
                            target.card.atk -= lowered;
                            totalLowered += lowered;
                            log(`${target.card.name.toUpperCase()}'S ATTACK LOWERED BY ${lowered}! (NOW ${target.card.atk} ATK)`);
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
                        }
                    }
                    log(`${card.name.toUpperCase()} COMPLETED MULTI-STRIKE, DEALING ${totalDamage} TOTAL DAMAGE!`);
                    break;
                }

                case 'drainHealthFromAll': {
                    // Steal HP from all enemies and heal self.
                    const enemyBoard = getOpposingBoard(context) || [];
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
                            }
                        }
                    }

                    if (totalDrained > 0) {
                        const healed = Math.min(unit.card.maxHp - unit.card.hp, totalDrained);
                        unit.card.hp += healed;
                        log(`${card.name.toUpperCase()} DRAINS ${totalDrained} HP FROM ALL ENEMIES AND HEALS FOR ${healed} HP! (NOW ${unit.card.hp} HP)`);
                    }
                    break;
                }
                case 'damageNexus': {
                    // Damage the opposite nexus for the specified amount
                    if (context.side === 'player') {
                        // Player unit damages enemy nexus
                        state.eHp -= amount;
                        log(`${card.name.toUpperCase()} DEALS ${amount} DAMAGE TO ENEMY NEXUS!`);
                        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                    } else {
                        // Enemy unit damages player nexus
                        state.pHp -= amount;
                        log(`${card.name.toUpperCase()} DEALS ${amount} DAMAGE TO YOUR NEXUS!`);
                        animateCard(document.getElementById('player-hp'), 'animate-ability');
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

        }
    }
        async function enemySpeak(text, duration = 2000) {
        triggerDialogue("Rival Duelist", text); // Call your existing VN dialogue box
        await delay(duration); // Wait for the text to type out and linger
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
            if (!effects || !Array.isArray(effects)) return;

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
                    image: getCardImage(card.name),
                    imageFallback: getCardImageJpg(card.name)
                }));
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
            if(id === 'arena' && state.hand.length === 0) startBattleInternal();
        }

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
                if (window.innerWidth > 768) {
                    if (isCollapsed) el.classList.add('hidden'); else el.classList.remove('hidden');
                } else {
                    if (isCollapsed) el.classList.add('hidden'); else el.classList.remove('hidden');
                }
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

        async function formatDescription(text) {
            if (!text) return 'No special abilities.';

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

                // 6. Horizontal line: --- or /n---/n
                text = text.replace(/(\/n)?---(\/n)?/g, '<div class="w-full h-px bg-gradient-to-r from-transparent via-purple-400/50 to-transparent my-1"></div>');

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
                // Using scaleY for flattening (vertical)
                text = text.replace(/\[flat\*(\d+)\](.*?)\[\/flat\]/g, '<span style="display: inline-block; transform: scaleX($1%);">$2</span>');

                // Using scaleX for stretching (horizontal)
                text = text.replace(/\[stretch\*(\d+)\](.*?)\[\/stretch\]/g, '<span style="display: inline-block; transform: scaleY($1%);">$2</span>');
            return text;
        }

        async function createCardUI(card, index, type, status = {}) {
            // card.image is now a plain URL string
            const imageSrc = card.image || '';
            const imageFallback = card.imageFallback || '';
            const descriptionHTML = await formatDescription(card.description);

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
                            <img src="${imageSrc}" onerror="if(this.src!=='${imageFallback.replace(/'/g, '\\\'')}')this.src='${imageFallback.replace(/'/g, '\\\'')}'" crossorigin="anonymous" class="w-8 h-8 mb-1 object-contain" alt="${card.name}">
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
                const startingNames = ["Amy Lyn"];
                
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

        async function updateBattleUI() {
            if(state.activeScreen !== 'arena') return;
            document.getElementById('player-hp').innerText = state.pHp;
            document.getElementById('enemy-hp').innerText = state.eHp;
            document.getElementById('mana-text').innerText = `${state.mana} / ${state.maxMana}`;
            
            const handEl = document.getElementById('player-hand');
            handEl.innerHTML = '';
            for (const [i, c] of state.hand.entries()) {
                const cardDiv = await createCardUI(c, i, 'hand');
                handEl.appendChild(cardDiv);
            }

            for(let i=0; i<4; i++) {
                await renderBattleSlot('player', i);
                await renderBattleSlot('enemy', i);
            }

            applyHandFan();
            markReadyCards();
        }

        async function renderBattleSlot(side, idx) {
            const slot = document.getElementById(`${side}-slot-${idx}`);
            slot.innerHTML = '';
            const unit = side === 'player' ? state.pBoard[idx] : state.eBoard[idx];
            if(unit) {
                const cardDiv = await createCardUI(unit.card, idx, 'board', unit.status);
                slot.appendChild(cardDiv);
                if (unit.status.justPlayed) {
                    setTimeout(() => { unit.status.justPlayed = false; }, 1000);
                }
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
                    def.status.silenced = true;
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
                            }
                        }
                    });
                    animateCard(defEl, 'animate-ability');
                }

                await triggerCardEvent('onAttack', atk, attackContext);
                
                // --- ON DEATH TRIGGERS ---
                if (def.card.hp <= 0) {
                    await triggerCardEvent('onDeath', def, { slot: eIdx, side: 'enemy', board: state.eBoard });
                    if (def.card.hp <= 0) animateCardDeath(defEl, () => { state.eBoard[eIdx] = null; });
                }

                if (atk.card.hp <= 0) {
                    await triggerCardEvent('onDeath', atk, { slot: pIdx, side: 'player', board: state.pBoard });
                    if (atk.card.hp <= 0) animateCardDeath(atkEl, () => { state.pBoard[pIdx] = null; });
                }

                const isEnergised = atk.status.energised;

                if (!isHaste2 && !isEnergised) {
                    atk.status.exhausted = true;
                } else if ((isHaste2 || isEnergised) && atk.card.hp > 0 && def && def.card.hp > 0) {
                    log(`${atk.card.name} ${isEnergised ? '(ENERGISED)' : '(HASTE2)'} strikes again!`);
                    animateCard(atkEl, 'animate-attack');
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
            [
                { side: 'player', board: state.pBoard },
                { side: 'enemy', board: state.eBoard }
            ].forEach(async group => {
                group.board.forEach(async (unit, idx) => {
                    if (unit) {
                        // Everyone triggers standard end-of-turn effects
                        await triggerCardEvent('onTurnEnd', unit, { side: group.side, slot: idx, board: group.board });
                        
                        // ONLY check Player units for missed attacks here
                        if (group.side === 'player' && unit.status.exhausted === false) {
                            await triggerCardEvent('whenNotAttack', unit, { side: group.side, slot: idx, board: group.board });
                            log(`${unit.card.name.toUpperCase()} DID NOT ATTACK, TRIGGERING ABILITY!`);
                        }
                    }
                });
            });

            updateBattleUI();
            log("ENEMY CYCLE STARTING...");
            
            const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);

            setTimeout(async () => {
                // 2. AI plays a card
                const slot = state.eBoard.findIndex(s => s === null);
                if(slot !== -1) {
                    const c = collectibleCards[Math.floor(Math.random()*collectibleCards.length)];
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
                                state.pHp -= u.card.atk;
                                log(`${u.card.name} hits your nexus for ${u.card.atk}.`);
                            } else {
                                const targetUnit = state.pBoard[targetIdx];
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
                        performAIStrike();

                        const isEnergised = atk.status.energised;

                        if (!isHaste2 && !isEnergised) {
                            atk.status.exhausted = true;
                        } else if ((isHaste2 || isEnergised) && atk.card.hp > 0 && def && def.card.hp > 0) {
                            log(`${atk.card.name} ${isEnergised ? '(ENERGISED)' : '(HASTE2)'} strikes again!`);
                            animateCard(atkEl, 'animate-attack');
                            atk.status.exhausted = true;
                        }
                    }

                    // Reset enemy statuses and decrement temporary effects
                    if(u) {
                        if (u.status.invincible > 0) u.status.invincible--;
                        if (u.status.shield > 0) u.status.shield--;
                        if (u.status.reflect > 0) u.status.reflect--;
                        if (u.status.invisible > 0) u.status.invisible--;
                        u.status.exhausted = false;
                        if (u.status.silenced > 0) u.status.silenced--;
                        u.status.justPlayed = false;
                    }
                });
                
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
                    } 
                });

                // 6. Trigger OnTurnStart effects
                [
                    { side: 'player', board: state.pBoard },
                    { side: 'enemy', board: state.eBoard }
                ].forEach(async group => {
                    group.board.forEach(async (unit, idx) => {
                        if (unit) {
                            await triggerCardEvent('onTurnStart', unit, { side: group.side, slot: idx, board: group.board });
                        }
                    });
                });
                
                draw();
                updateBattleUI();
                log("YOUR CYCLE.");
                checkVictory();
            }, 600);
        }

        function checkVictory() {
            if(state.eHp <= 0) { 
                alert("VICTORY - ENEMY NEXUS DESTROYED"); 
                showScreen('lobby'); 
            }
            else if(state.pHp <= 0) { 
                alert("DEFEAT - YOUR NEXUS HAS FALLEN"); 
                showScreen('lobby'); 
            }
        }

        let isDialogueActive = false;

        function showDialogue(speaker, text) {
            isDialogueActive = true;
            const dialogBox = document.getElementById('vn-dialogue');
            const speakerName = document.getElementById('vn-speaker');
            const dialogText = document.getElementById('vn-text');
            
            speakerName.innerText = "Opponent";
            dialogText.innerText = ""; // Clear for typewriter effect
            dialogBox.classList.remove('hidden');
            
            // Simple typewriter effect
            let i = 0;
            const typeWriter = setInterval(() => {
                dialogText.innerText += text.charAt(i);
                i++;
                if (i >= text.length) clearInterval(typeWriter);
            }, 30); // Speed of typing
        }

        // Click to dismiss dialogue
        document.getElementById('vn-dialogue').addEventListener('click', () => {
            document.getElementById('vn-dialogue').classList.add('hidden');
            isDialogueActive = false;
            // Resume game logic if needed here
        });

/* ============================================================
   MIKU.BATTLE.GG — ARENA ANIMATION UPGRADES  (scripts patch)
   ============================================================
   HOW TO INTEGRATE
   ────────────────
   1. Paste this ENTIRE file at the very BOTTOM of scripts.js,
      just before the final closing line (after window.onload).

   2. Then find and REPLACE these three existing functions
      in your original scripts.js with the upgraded versions
      provided in the "REPLACE THESE" section below.

   3. In the existing updateBattleUI function, add these two
      lines right before the closing brace:
          applyHandFan();
          markReadyCards();

   That's it. No other changes needed.
   ============================================================ */


/* ══════════════════════════════════════════════════════════
   SECTION A — NEW UTILITY FUNCTIONS  (just paste these in)
   ══════════════════════════════════════════════════════════ */

/**
 * spawnDamagePopup(el, text, type)
 * Spawns a floating damage/heal number over a DOM element.
 */
function spawnDamagePopup(el, text, type = 'dmg') {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = `dmg-popup ${type}${Math.abs(parseInt(text)) >= 5 ? ' big' : ''}`;
    popup.textContent = text;
    popup.style.left = `${rect.left + rect.width / 2 - 20}px`;
    popup.style.top  = `${rect.top  + rect.height / 2}px`;
    document.body.appendChild(popup);
    popup.addEventListener('animationend', () => popup.remove());
}

/**
 * shakeArena(intense)
 * Shakes the arena div when a nexus is hit directly.
 */
function shakeArena(intense = false) {
    const arena = document.getElementById('screen-arena');
    if (!arena) return;
    arena.classList.remove('arena-shake');
    void arena.offsetWidth;
    arena.classList.add('arena-shake');
    setTimeout(() => arena.classList.remove('arena-shake'), 500);

    const flashClass = intense ? 'flash-red' : 'flash-indigo';
    arena.classList.remove('flash-red', 'flash-indigo');
    void arena.offsetWidth;
    arena.classList.add(flashClass);
    setTimeout(() => arena.classList.remove(flashClass), 450);
}

/**
 * spawnImpactBurst(el, color)
 * Spawns ~10 small particles radiating outward from element's centre.
 */
function spawnImpactBurst(el, color = '#f87171') {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const dist  = 35 + Math.random() * 45;
        const p = document.createElement('div');
        p.className = 'impact-particle';
        p.style.cssText = `
            left: ${cx - 3}px; top: ${cy - 3}px;
            background: ${color};
            --px: ${Math.cos(angle) * dist}px;
            --py: ${Math.sin(angle) * dist}px;
            animation-duration: ${0.35 + Math.random() * 0.25}s;
        `;
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
    }
}

/**
 * showTurnBanner(who)
 * Shows a cinematic "YOUR TURN" / "ENEMY TURN" banner.
 */
function showTurnBanner(who) {
    const existing = document.getElementById('turn-banner');
    if (existing) existing.remove();
    const label   = who === 'player' ? 'YOUR TURN' : 'ENEMY TURN';
    const wrapper = document.createElement('div');
    wrapper.id    = 'turn-banner';
    wrapper.innerHTML = `<div class="turn-banner-inner ${who}">${label}</div>`;
    document.body.appendChild(wrapper);
    setTimeout(() => wrapper.remove(), 1700);
}

/**
 * showEndModal(result)
 * Replaces the plain alert() for victory / defeat.
 */
function showEndModal(result) {
    const existing = document.getElementById('end-modal');
    if (existing) existing.remove();
    const isVictory = result === 'victory';
    const modal = document.createElement('div');
    modal.id = 'end-modal';
    modal.innerHTML = `
        <div class="end-modal-box ${result}">
            <div class="end-title">${isVictory ? 'VICTORY' : 'DEFEAT'}</div>
            <div class="end-sub">${isVictory ? 'Enemy Nexus Destroyed' : 'Your Nexus Has Fallen'}</div>
            <button class="end-modal-btn" onclick="
                document.getElementById('end-modal').remove();
                showScreen('lobby');
            ">${isVictory ? 'Return to Lobby' : 'Try Again'}</button>
        </div>
    `;
    document.body.appendChild(modal);
}

/**
 * animateCardDeath(el, onNullCallback)
 *
 * KEY FIX: We do NOT remove the element here. updateBattleUI re-renders
 * the slot from scratch, so removing early causes the card to vanish
 * immediately. Instead: play the animation, call onNullCallback (which
 * sets the board slot to null), then let the next updateBattleUI clear
 * the DOM naturally.
 *
 * The animation duration in CSS is 0.55s. We add a tiny buffer (600ms)
 * so the visual completes before the grid re-renders.
 */
function animateCardDeath(el, onNullCallback) {
    if (!el) { onNullCallback?.(); return; }
    el.classList.add('is-dying');
    // Wait for animation then null the state — caller's updateBattleUI
    // will re-render the slot to an empty dashed box.
    setTimeout(async () => {
        onNullCallback?.();
    }, 580);
}

/**
 * applyHandFan()
 * Sets --fan-i and --fan-n CSS vars so the hand-fan arc works.
 * Call this after updateBattleUI.
 */
function applyHandFan() {
    const cards = document.querySelectorAll('#player-hand .card-nexus');
    const n = cards.length;
    cards.forEach((card, i) => {
        card.style.setProperty('--fan-i', i);
        card.style.setProperty('--fan-n', n);
    });
}

/**
 * markReadyCards()
 * Adds .ready-to-attack to player board cards that can still act.
 */
function markReadyCards() {
    for (let i = 0; i < 4; i++) {
        const el   = document.querySelector(`#player-slot-${i} .card-nexus`);
        const unit = state.pBoard[i];
        if (!el || !unit) continue;
        if (!unit.status.exhausted && !unit.status.silenced) {
            el.classList.add('ready-to-attack');
        } else {
            el.classList.remove('ready-to-attack');
        }
    }
}


/* ══════════════════════════════════════════════════════════
   SECTION B — REPLACE THESE FUNCTIONS IN scripts.js
   ══════════════════════════════════════════════════════════ */

/* ── REPLACE: checkVictory ───────────────────────────────── */
function checkVictory() {
    if (state.eHp <= 0) {
        showEndModal('victory');
        showScreen('lobby');
    } else if (state.pHp <= 0) {
        showEndModal('defeat');
        showScreen('lobby');
    }
}

/* ── REPLACE: endTurn ────────────────────────────────────── */
async function endTurn() {
    // 1. Trigger End of Turn effects
    [
        { side: 'player', board: state.pBoard },
        { side: 'enemy',  board: state.eBoard }
    ].forEach(async group => {
        group.board.forEach(async (unit, idx) => {
            if (unit) {
                await triggerCardEvent('onTurnEnd', unit, { side: group.side, slot: idx, board: group.board });
                if (group.side === 'player' && unit.status.exhausted === false) {
                    await triggerCardEvent('whenNotAttack', unit, { side: group.side, slot: idx, board: group.board });
                    log(`${unit.card.name.toUpperCase()} DID NOT ATTACK, TRIGGERING ABILITY!`);
                }
            }
        });
    });

    updateBattleUI();
    log("ENEMY CYCLE STARTING...");
    showTurnBanner('enemy');

    const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);

    setTimeout(async () => {
        // 2. AI plays a card
        const slot = state.eBoard.findIndex(s => s === null);
        if (slot !== -1) {
            const c = collectibleCards[Math.floor(Math.random() * collectibleCards.length)];
            const enemyUnit = {
                card: cloneCard(c),
                status: { exhausted: true, justPlayed: true, silenced: false }
            };
            state.eBoard[slot] = enemyUnit;
            await triggerCardEvent('onPlay', enemyUnit, { slot, side: 'enemy', board: state.eBoard });
        }

        // 3. AI Attacks
        state.eBoard.forEach(async (u, enemyIdx) => {
            if (u && !u.status.exhausted && !u.status.silenced) {

                const performAIStrike = async () => {
                    let targetType = 'nexus';
                    let targetIdx  = -1;

                    const guardIndex = state.pBoard.findIndex(v => v && v.card.ability === 'guard');
                    if (guardIndex !== -1) {
                        targetType = 'unit';
                        targetIdx  = guardIndex;
                    } else {
                        const validTargets = [{ type: 'nexus' }];
                        state.pBoard.forEach((pUnit, idx) => {
                            if (pUnit) validTargets.push({ type: 'unit', idx });
                        });
                        const chosen = validTargets[Math.floor(Math.random() * validTargets.length)];
                        targetType = chosen.type;
                        targetIdx  = chosen.idx;
                    }

                    if (targetType === 'nexus') {
                        state.pHp -= u.card.atk;
                        log(`${u.card.name} hits your nexus for ${u.card.atk}.`);
                        spawnDamagePopup(document.getElementById('player-hp'), `-${u.card.atk}`, 'dmg');
                        shakeArena(u.card.atk >= 4);
                    } else {
                        const targetUnit = state.pBoard[targetIdx];
                        const preDefHp   = targetUnit.card.hp;
                        const defEl      = getSlotCard('player', targetIdx);
                        const atkEl      = getSlotCard('enemy', enemyIdx);

                        await triggerCardEvent('whenAttacked', targetUnit, { target: u, slot: targetIdx, side: 'player', board: state.pBoard });
                        await triggerCardEvent('whenAttacked', u, { target: targetUnit, slot: enemyIdx, side: 'enemy', board: state.eBoard });

                        if (targetUnit.status && targetUnit.status.invincible > 0) {
                            log(`INVINCIBLE: ${targetUnit.card.name} blocked the hit!`);
                        } else {
                            targetUnit.card.hp -= u.card.atk;
                            spawnDamagePopup(defEl, `-${u.card.atk}`, 'dmg');
                            spawnImpactBurst(defEl, '#f87171');
                            animateCard(defEl, 'animate-hit-flicker');
                        }

                        if (u.status && u.status.invincible > 0) {
                            log(`INVINCIBLE: ${u.card.name} takes no counter damage!`);
                        } else {
                            u.card.hp -= targetUnit.card.atk;
                            spawnDamagePopup(atkEl, `-${targetUnit.card.atk}`, 'dmg');
                        }

                        // Death: animate, then null state — updateBattleUI at bottom cleans up DOM
                        if (targetUnit.card.hp <= 0) {
                            log(`${targetUnit.card.name} is destroyed.`);
                            await triggerCardEvent('onDeath', targetUnit, { slot: targetIdx, side: 'player', board: state.pBoard });
                            if (u.card.ability === 'berserk') {
                                const overflow = Math.max(0, u.card.atk - preDefHp);
                                if (overflow > 0) {
                                    state.pHp -= overflow;
                                    log(`BERSERK OVERFLOW: ${overflow} damage to nexus.`);
                                    shakeArena(true);
                                }
                            }
                            animateCardDeath(defEl, () => { state.pBoard[targetIdx] = null; });
                        }

                        if (u.card.hp <= 0) {
                            await triggerCardEvent('onDeath', u, { slot: enemyIdx, side: 'enemy', board: state.eBoard });
                            animateCardDeath(atkEl, () => { state.eBoard[enemyIdx] = null; });
                        }
                    }
                };

                performAIStrike();

                if (u && u.card.hp > 0 && u.card.ability === 'haste2' && !u.status.exhausted) {
                    log(`HASTE2: ${u.card.name} strikes again!`);
                    performAIStrike();
                }
            }

            if (u) {
                if (u.status.invincible > 0) u.status.invincible--;
                if (u.status.shield > 0) u.status.shield--;
                if (u.status.reflect > 0) u.status.reflect--;
                if (u.status.invisible > 0) u.status.invisible--;
                u.status.exhausted  = false;
                if (u.status.silenced > 0) u.status.silenced--;
                u.status.justPlayed = false;
            }
        });

        // 4. Resource Refresh
        if (state.maxMana < 10) state.maxMana++;
        state.mana = state.maxMana;

        // 5. Reset player statuses
        state.pBoard.forEach(u => {
            if (u) {
                if (u.status.invincible > 0) u.status.invincible--;
                if (u.status.shield > 0) u.status.shield--;
                if (u.status.reflect > 0) u.status.reflect--;
                if (u.status.invisible > 0) u.status.invisible--;
                u.status.exhausted  = false;
                u.status.justPlayed = false;
                if (u.status.silenced > 0) u.status.silenced--;
            }
        });

        // 6. Trigger OnTurnStart effects
        [
            { side: 'player', board: state.pBoard },
            { side: 'enemy',  board: state.eBoard }
        ].forEach(async group => {
            group.board.forEach(async (unit, idx) => {
                if (unit) await triggerCardEvent('onTurnStart', unit, { side: group.side, slot: idx, board: group.board });
            });
        });

        draw();
        // Delay final UI update slightly so death animations can play out first
        setTimeout(() => {
            updateBattleUI();
            log("YOUR CYCLE.");
            checkVictory();
            showTurnBanner('player');
        }, 620);

    }, 600);
}

/* ── REPLACE: handleStrike ───────────────────────────────── */
async function handleStrike(pIdx, eIdx) {
    const atk = state.pBoard[pIdx];
    const def = state.eBoard[eIdx];

    if (!atk || !def || atk.status.exhausted) return;

    const guard = state.eBoard.some(u => u && u.card.ability === 'guard');
    if (guard && def.card.ability !== 'guard' && atk.card.ability !== 'snipe') {
        log("GUARD ACTIVE: TARGET BLOCKED.");
        return;
    }
    if (atk.status.silenced) {
        log(`${atk.card.name} is silenced and cannot attack this round.`);
        return;
    }

    const atkEl = getSlotCard('player', pIdx);
    const defEl = getSlotCard('enemy',  eIdx);
    const atkRect = atkEl?.getBoundingClientRect();
    const defRect = defEl?.getBoundingClientRect();

    atkEl?.style.setProperty('--slam-target-x', `${(defRect?.x ?? 0) - (atkRect?.x ?? 0)}px`);
    atkEl?.style.setProperty('--slam-target-y', `${(defRect?.y ?? 0) - (atkRect?.y ?? 0)}px`);

    animateCard(atkEl, 'animate-slam-up');

    setTimeout(async () => {
        animateCard(atkEl, 'animate-hit-flicker');
        animateCard(defEl, 'animate-hit-flicker');
        spawnImpactBurst(defEl, '#f87171');
        spawnImpactBurst(atkEl, '#818cf8');
    }, 200);

    setTimeout(async () => {
        if (atk.card.ability === 'heal') animateCard(document.getElementById('player-hp'), 'animate-heal');

        const preDefHp = def.card.hp;

        await triggerCardEvent('whenAttacked', def, { target: atk, slot: eIdx, side: 'enemy', board: state.eBoard });
        await triggerCardEvent('whenAttacked', atk, { target: def, slot: pIdx, side: 'player', board: state.pBoard });

        // Apply damage
        if (def.status && def.status.invincible > 0) {
            log(`${def.card.name.toUpperCase()} IS INVINCIBLE! NO DAMAGE TAKEN.`);
            spawnDamagePopup(defEl, 'BLOCK', 'buff');
        } else {
            def.card.hp -= atk.card.atk;
            spawnDamagePopup(defEl, `-${atk.card.atk}`, 'dmg');
        }

        if (atk.status && atk.status.invincible > 0) {
            log(`${atk.card.name.toUpperCase()} IS INVINCIBLE! NO COUNTER DAMAGE.`);
            spawnDamagePopup(atkEl, 'BLOCK', 'buff');
        } else {
            atk.card.hp -= def.card.atk;
            spawnDamagePopup(atkEl, `-${def.card.atk}`, 'dmg');
        }

        const isHaste2      = atk.card.ability === 'haste2';
        const attackContext = {
            target: def,
            targetIdx: eIdx,
            defenderHp: preDefHp,
            side: 'player',
            board: state.pBoard,
            opponentBoard: state.eBoard
        };

        // Abilities
        if (atk.card.ability === 'silence') {
            def.status.silenced = true;
            log(`${def.card.name} is SILENCED.`);
            animateCard(defEl, 'animate-ability');
        }
        if (atk.card.ability === 'berserk' && def.card.hp <= 0) {
            const overflow = Math.max(0, atk.card.atk - preDefHp);
            if (overflow > 0) {
                state.eHp -= overflow;
                log(`BERSERK OVERFLOW: ${overflow} DMG TO ENEMY NEXUS`);
                animateCard(document.getElementById('enemy-hp'), 'animate-ability');
                spawnDamagePopup(document.getElementById('enemy-hp'), `-${overflow}`, 'dmg');
                shakeArena(true);
            }
        }
        if (atk.card.ability === 'heal') {
            const healAmount = Math.min(5, Math.ceil(atk.card.atk / 2));
            state.pHp = Math.min(30, state.pHp + healAmount);
            log(`HEAL: ${healAmount} TO YOUR NEXUS`);
            spawnDamagePopup(document.getElementById('player-hp'), `+${healAmount}`, 'heal');
        }
        if (atk.card.ability === 'splash') {
            [eIdx - 1, eIdx + 1].forEach(adj => {
                if (state.eBoard[adj]) {
                    state.eBoard[adj].card.hp -= 1;
                    const adjEl = getSlotCard('enemy', adj);
                    spawnDamagePopup(adjEl, '-1', 'dmg');
                    if (state.eBoard[adj].card.hp <= 0) {
                        log(`${state.eBoard[adj].card.name} TAKES SPLASH AND DIES`);
                        animateCardDeath(adjEl, () => { state.eBoard[adj] = null; });
                    } else {
                        log(`${state.eBoard[adj].card.name} TAKES SPLASH`);
                    }
                }
            });
            animateCard(defEl, 'animate-ability');
        }

        await triggerCardEvent('onAttack', atk, attackContext);

        // Death resolution — animate, null state, then single updateBattleUI below
        if (def.card.hp <= 0) {
            await triggerCardEvent('onDeath', def, { slot: eIdx, side: 'enemy', board: state.eBoard });
            if (def.card.hp <= 0) animateCardDeath(defEl, () => { state.eBoard[eIdx] = null; });
        }
        if (atk.card.hp <= 0) {
            await triggerCardEvent('onDeath', atk, { slot: pIdx, side: 'player', board: state.pBoard });
            if (atk.card.hp <= 0) animateCardDeath(atkEl, () => { state.pBoard[pIdx] = null; });
        }

        if (!isHaste2) {
            atk.status.exhausted = true;
        } else if (atk.card.hp > 0 && def && def.card.hp > 0) {
            log(`${atk.card.name} (HASTE2) strikes again!`);
            animateCard(atkEl, 'animate-attack');
            atk.status.exhausted = true;
        }

        // Delay the final UI update so death animations can play out (580ms) before the slot clears
        setTimeout(() => {
            updateBattleUI();
            checkVictory();
        }, 620);

    }, 400);
}

/* ── REPLACE: dropOnNexus ────────────────────────────────── */
async function dropOnNexus(side) {
    if (!state.dragging) return;
    if (state.dragging.type === 'board' && side === 'enemy') {
        const atk   = state.pBoard[state.dragging.index];
        const atkEl = getSlotCard('player', state.dragging.index);

        if (!atk || atk.status.exhausted || atk.status.silenced) {
            if (atk && atk.status.silenced) log(`${atk.card.name} is silenced and cannot strike nexus.`);
            return;
        }
        if (state.eBoard.some(u => u && u.card.ability === 'guard')) return log("CORE GUARDED.");

        animateCard(atkEl, 'animate-attack');
        state.eHp -= atk.card.atk;
        animateCard(document.getElementById('enemy-hp'), 'animate-ability');
        spawnDamagePopup(document.getElementById('enemy-hp'), `-${atk.card.atk}`, 'dmg');
        shakeArena(atk.card.atk >= 4);
        await triggerCardEvent('onAttack', atk, {
            target: 'enemyNexus',
            side: 'player',
            board: state.pBoard,
            opponentBoard: state.eBoard
        });

        if (atk.card.ability === 'heal') {
            const healAmount = Math.max(1, Math.floor(atk.card.atk / 2));
            state.pHp = Math.min(30, state.pHp + healAmount);
            log(`HEAL: +${healAmount} to your nexus.`);
            animateCard(document.getElementById('player-hp'), 'animate-heal');
            spawnDamagePopup(document.getElementById('player-hp'), `+${healAmount}`, 'heal');
        }
        if (atk.card.ability === 'haste2') {
            state.eHp -= atk.card.atk;
            log(`HASTE2 BONUS: additional ${atk.card.atk} DMG to nexus.`);
            animateCard(document.getElementById('enemy-hp'), 'animate-ability');
            spawnDamagePopup(document.getElementById('enemy-hp'), `-${atk.card.atk}`, 'dmg');
            shakeArena(true);
        }

        atk.status.exhausted = true;
        log(`DIRECT STRIKE: ${atk.card.atk} DMG.`);
        updateBattleUI();
        checkVictory();
    }
    state.dragging = null;
}

// Type map: keywords → entry type for colour coding
const LOG_TYPE_RULES = [
    { pattern: /deploy|played|summoned|placed/i,  type: 'deploy' },
    { pattern: /damage|hit|strike|attack|dmg|overflow|splash/i, type: 'dmg' },
    { pattern: /heal|recover|nexus.*\+/i,         type: 'heal'   },
    { pattern: /destroy|die|death|eliminated|killed/i, type: 'death' },
    { pattern: /your cycle|enemy cycle|round|turn|ready/i, type: 'system' },
];

function classifyLog(msg) {
    for (const rule of LOG_TYPE_RULES) {
        if (rule.pattern.test(msg)) return rule.type;
    }
    return 'info';
}

// Override the global log() function
function log(m) {
    // Keep ticker working if it still exists (graceful)
    const t = document.getElementById('ticker');
    if (t) t.innerText = `${m} • ${t.innerText}`.substring(0, 300);

    // Add to VN log panel
    const entries = document.getElementById('battle-log-entries');
    if (!entries) return;

    const type    = classifyLog(m);
    const entry   = document.createElement('div');
    entry.className = `log-entry type-${type}`;

    const tagLabels = { dmg: 'ATK', heal: 'HEAL', deploy: 'DEPLOY', system: '—', death: 'RIP', info: '' };
    const tag = tagLabels[type] || '';

    entry.innerHTML = tag
        ? `<span class="log-tag">${tag}</span>${m}`
        : m;

    entries.prepend(entry);

    // Keep max 60 entries
    while (entries.children.length > 60) entries.lastChild.remove();
}

/* ── VN Dialogue (redesigned) ───────────────────────────── */

let _vnQueue        = [];   // queued {speaker, text, portrait} objects
let _vnActive       = false;
let _vnTyperTimer   = null;
let _vnResolve      = null; // resolves the current waitForDialogue promise
let _vnAutoClose    = false; // true = close without waiting for click

/**
 * showDialogue(speaker, text, options)
 * options.portrait  – img src override
 * options.autoClose – auto-dismiss after typing (no click needed)
 * options.delay     – ms before showing (default 0)
 * Returns a Promise that resolves when dismissed.
 */
function showDialogue(speaker, text, options = {}) {
    return new Promise(resolve => {
        _vnQueue.push({ speaker, text, options, resolve });
        if (!_vnActive) _vnFlush();
    });
}

function _vnFlush() {
    if (_vnQueue.length === 0) { _vnActive = false; return; }
    _vnActive = true;
    const { speaker, text, options, resolve } = _vnQueue.shift();
    _vnResolve = resolve;
    _vnAutoClose = !!options.autoClose;

    const box      = document.getElementById('vn-dialogue');
    const spkEl    = document.getElementById('vn-speaker');
    const txtEl    = document.getElementById('vn-text');
    const portrait = document.getElementById('vn-portrait');

    if (!box) { resolve?.(); _vnFlush(); return; }

    // Set speaker name
    spkEl.textContent = speaker;

    // Set portrait image
    const existingImg = portrait.querySelector('img');
    const fallback    = portrait.querySelector('.portrait-fallback');

    if (options.portrait) {
        if (!existingImg) {
            const img = document.createElement('img');
            portrait.innerHTML = '';
            portrait.appendChild(img);
            img.src = options.portrait;
            img.onerror = () => { portrait.innerHTML = '<div class="portrait-fallback">⚔️</div>'; };
        } else {
            existingImg.src = options.portrait;
        }
        if (fallback) fallback.style.display = 'none';
    } else {
        portrait.innerHTML = '<div class="portrait-fallback">⚔️</div>';
    }

    // Clear old text
    txtEl.innerHTML = '';

    // Detect emotion from text and apply to box
    const EMOTION_CLASSES = ['vn-emotion-angry','vn-emotion-excited','vn-emotion-sad','vn-emotion-smug','vn-emotion-taunt','vn-emotion-fear'];
    box.classList.remove(...EMOTION_CLASSES);
    const t = text.toLowerCase();
    if (/!{2,}|destroy|crush|die|pathetic|useless|fool/.test(t))          box.classList.add('vn-emotion-angry');
    else if (/\?!|heh|finally|perfect|too easy|mine now/.test(t))          box.classList.add('vn-emotion-taunt');
    else if (/ha|yes!|incredible|unstoppable|magnificent/.test(t))          box.classList.add('vn-emotion-excited');
    else if (/sorry|forgive|i'm sorry|losing|won't last/.test(t))           box.classList.add('vn-emotion-sad');
    else if (/as expected|predictable|obvious|i knew|of course/.test(t))    box.classList.add('vn-emotion-smug');
    else if (/no\.\.\.|please|stop|i can't|overwhelmed|too strong/.test(t)) box.classList.add('vn-emotion-fear');

    // Show the box
    box.classList.remove('hidden');
    box.classList.add('vn-visible');

    // Typewriter
    let i = 0;
    clearInterval(_vnTyperTimer);
    _vnTyperTimer = setInterval(() => {
        if (i < text.length) {
            txtEl.textContent += text.charAt(i);
            i++;
        } else {
            clearInterval(_vnTyperTimer);
            // Append blinking cursor
            const cursor = document.createElement('span');
            cursor.id = 'vn-cursor';
            txtEl.appendChild(cursor);

            if (_vnAutoClose) {
                // Auto-dismiss after a brief pause
                setTimeout(_vnDismiss, 1200);
            }
        }
    }, 28);
}

function _vnDismiss() {
    clearInterval(_vnTyperTimer);
    const box = document.getElementById('vn-dialogue');
    if (box) {
        box.classList.remove('vn-visible');
        box.classList.remove('vn-emotion-angry','vn-emotion-excited','vn-emotion-sad','vn-emotion-smug','vn-emotion-taunt','vn-emotion-fear');
    }
    const resolve = _vnResolve;
    _vnResolve  = null;
    _vnActive   = false;
    resolve?.();
    // Small gap between lines
    setTimeout(_vnFlush, 180);
}

// Click-to-dismiss (only when not auto-closing)
document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('vn-dialogue');
    if (box) {
        box.addEventListener('click', () => {
            if (_vnActive && !_vnAutoClose) {
                clearInterval(_vnTyperTimer);
                _vnDismiss();
            } else if (_vnActive && _vnAutoClose) {
                // Skip typing and dismiss immediately
                clearInterval(_vnTyperTimer);
                _vnDismiss();
            }
        });
    }

    // Show log panel when entering arena
    const arenaBtn = document.getElementById('btn-arena');
    // We handle this in showScreen override below
});

/* ── Mark arena-active on body so CSS log panel slides in ── */
const _origShowScreen = typeof showScreen === 'function' ? showScreen : null;
// We'll patch this after definition — see bottom of this file.

/* ── Enemy Dialogue Lines ───────────────────────────────── */

const ENEMY_LINES = {
    deploy: [
        "Let's see how you handle this one.",
        "A new unit enters the field.",
        "I've been saving this for the right moment.",
        "This changes things.",
        "Come forward.",
        "Don't underestimate what I've just placed.",
    ],
    attackUnit: [
        (atk, def) => `${atk} — eliminate ${def}.`,
        (atk, def) => `Take down ${def}. Now.`,
        (atk, def) => `${atk}, your target is ${def}.`,
        (atk, def) => `${def} won't survive this.`,
        (atk, def) => `I've calculated this perfectly. ${atk} moves.`,
        (atk, def) => `${def} is a liability. Remove it.`,
    ],
    attackNexus: [
        (atk) => `Strike directly. Hit their core.`,
        (atk) => `${atk} — go for the nexus.`,
        (atk) => `No units worth targeting. Nexus it is.`,
        (atk) => `Every hit counts. ${atk}, move.`,
        (atk) => `I'll chip away at your foundation.`,
    ],
    unitDied: [
        (name) => `${name} — you served your purpose.`,
        (name) => `${name} falls. A sacrifice I'd calculated.`,
        (name) => `Unfortunate. But expected.`,
        (name) => `${name} is gone. Adapt.`,
    ],
    playerUnitDied: [
        (name) => `${name} has been eliminated. As expected.`,
        (name) => `One less obstacle.`,
        (name) => `Your ${name} couldn't withstand that.`,
        (name) => `Good riddance to ${name}.`,
    ],
    nexusHit: [
        `Your core weakens.`,
        `Feel that.`,
        `The damage accumulates.`,
        `Your nexus can't take much more.`,
    ],
    turnStart: [
        `My move.`,
        `Let me think...`,
        `The field is mine now.`,
        `Analyzing your formation.`,
        `I see several options.`,
    ],
    turnEnd: [
        `Your turn, Commander.`,
        `Make your play.`,
        `Show me what you've got.`,
        `I'll be watching.`,
    ],
};

// Character-specific dialogue loaded from dialogue.json
let CHAR_DIALOGUE = {};
(async () => {
    try {
        const res = await fetch('dialogue.json');
        if (res.ok) {
            const data = await res.json();
            CHAR_DIALOGUE = data.characters || {};
            console.log(`Loaded dialogue.json (${Object.keys(CHAR_DIALOGUE).length} characters)`);
        }
    } catch(e) {
        console.warn('dialogue.json not found, using default lines only.', e);
    }
})();

function _enemyLine(category, speakerName, ...args) {
    // Always use hardcoded ENEMY_LINES — never look up character-specific dialogue
    const pool = ENEMY_LINES[category];
    if (!pool || pool.length === 0) return "...";

    const item = pool[Math.floor(Math.random() * pool.length)];

    try {
        if (typeof item === 'function') {
            // Provide fallback strings if args are missing to prevent "undefined"
            const safeArgs = args.map(arg => (arg !== undefined && arg !== null) ? arg : "Unit");
            return item(...safeArgs);
        }
        return item;
    } catch (e) {
        console.error("Dialogue Error:", e);
        return "Moving out.";
    }
}

function _getEnemySpeaker() {
    // If there's an enemy unit on the board, use its name
    return 'Opponent';
}

function _getEnemyPortrait() {
    const activeUnit = state.eBoard.find(u => u);
    if (!activeUnit) return null;
    // Try to get the card's image (it's an async function in the original code,
    // so we cache the last known URL on the unit itself)
    return activeUnit._cachedPortrait || null;
}

function _deathAnimateAllCards() {
    state.board.forEach(unit, idx); {
        if (unit.card.hp <= 0) {
            animateCardDeath(defEl, () => { state.pBoard[targetIdx] = null; });
        }
    }
}

/* Cache portrait URLs when cards are rendered */
const _origRenderBattleSlot = typeof renderBattleSlot === 'function' ? renderBattleSlot : null;


/* ══════════════════════════════════════════════════════════
   SECTION C — REPLACE endTurn WITH SEQUENCED VERSION
   ══════════════════════════════════════════════════════════ */

/**
 * Sequenced enemy turn:
 *   1. Banner + opening line
 *   2. Play a card (with dialogue)
 *   3. Each attack (with dialogue, visual, delay)
 *   4. Closing line + "YOUR TURN" banner
 *
 * Uses async/await + a small sleep() helper so each action
 * is staggered and the player can actually read the dialogue.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function endTurn() {

    // ── Helper: read a card name safely, never returns undefined ──────────
    function n(unit) {
        if (!unit) return 'Unknown';
        const card = unit.card ?? unit;
        return (card && card.name) ? card.name : 'Unknown';
    }

    // ── 1. End-of-player-turn triggers ────────────────────────────────────
    // onTurnEnd for every unit on both boards
    [
        { side: 'player', board: state.pBoard },
        { side: 'enemy',  board: state.eBoard }
    ].forEach(async group => {
        group.board.forEach(async (unit, idx) => {
            if (!unit) return;
            await triggerCardEvent('onTurnEnd', unit, { side: group.side, slot: idx, board: group.board });
        });
    });

    // whenNotAttack for player units that never attacked this turn
    state.pBoard.forEach(async (unit, idx) => {
        if (unit && !unit.status.exhausted) {
            await triggerCardEvent('whenNotAttack', unit, { side: 'player', slot: idx, board: state.pBoard });
        }
    });

    // ── 2. Reset enemy unit statuses so they can attack this turn ─────────
    state.eBoard.forEach(u => {
        if (!u) return;
        u.status.exhausted  = false;
        u.status.justPlayed = false;
        if (u.status.invincible > 0) u.status.invincible--;
        if (u.status.shield > 0) u.status.shield--;
        if (u.status.reflect > 0) u.status.reflect--;
        if (u.status.invisible > 0) u.status.invisible--;
        if (u.status.silenced  > 0) u.status.silenced--;
    });

    updateBattleUI();

    // ── 3. Opening banner + dialogue ──────────────────────────────────────
    showTurnBanner('enemy');
    await sleep(400);

    const openingLine = _enemyLine('turnStart', 'Opponent');
    await showDialogue('Opponent', openingLine, { autoClose: true });
    await sleep(300);

    // ── 4. AI plays a card ────────────────────────────────────────────────
    const emptySlot = state.eBoard.findIndex(s => s === null);
    if (emptySlot !== -1) {
        const collectibleCards = ALL_CHARS.filter(c => !c.isKeyCard);
        const c = collectibleCards[Math.floor(Math.random() * collectibleCards.length)];
        const enemyUnit = {
            card:   cloneCard(c),
            status: { exhausted: true, justPlayed: true, silenced: 0, invincible: 0 }
        };
        state.eBoard[emptySlot] = enemyUnit;
        await triggerCardEvent('onPlay', enemyUnit, { slot: emptySlot, side: 'enemy', board: state.eBoard });
        updateBattleUI();
        log(`${c.name.toUpperCase()} DEPLOYED TO ENEMY FIELD.`);

        const deployLine = _enemyLine('deploy', c.name);
        await showDialogue('Opponent', deployLine, { autoClose: true });
        await sleep(400);
    }

    // ── 5. AI attack loop ─────────────────────────────────────────────────
    // Snapshot the indices to attack with — we iterate by index so we always
    // re-read state.eBoard[idx] fresh on every access instead of holding a
    // stale reference captured before a unit could die.

    for (let enemyIdx = 0; enemyIdx < state.eBoard.length; enemyIdx++) {

        // Re-read from the board every time — never use a captured reference
        const attacker = () => state.eBoard[enemyIdx];

        // Skip if slot is empty, card is exhausted, silenced, or just played
        const a = attacker();
        if (!a || a.status.exhausted || a.status.silenced > 0 || a.status.justPlayed) continue;

        // ── Single strike (called once, or twice for haste2) ──────────────
        const performStrike = async () => {

            // Re-read attacker at the start of every strike
            const atk = attacker();
            if (!atk || atk.card.hp <= 0) return; // attacker died before this strike

            const atkName = n(atk);
            const atkEl   = getSlotCard('enemy', enemyIdx);

            // ── Determine target ──────────────────────────────────────────
            // Guard check: find the first alive guard on the player board
            const guardIdx = state.pBoard.findIndex(v => v && v.card && v.card.ability === 'guard' && v.card.hp > 0);

            let targetType = 'nexus';
            let targetIdx  = -1;

            if (guardIdx !== -1) {
                targetType = 'unit';
                targetIdx  = guardIdx;
            } else {
                // Pick randomly between nexus and any alive player unit
                const validTargets = [{ type: 'nexus' }];
                state.pBoard.forEach((pUnit, idx) => {
                    if (pUnit && pUnit.card && pUnit.card.hp > 0) {
                        validTargets.push({ type: 'unit', idx });
                    }
                });
                const chosen = validTargets[Math.floor(Math.random() * validTargets.length)];
                targetType = chosen.type;
                targetIdx  = chosen.idx ?? -1;
            }

            // ── Strike: nexus ─────────────────────────────────────────────
            if (targetType === 'nexus') {
                const line = _enemyLine('attackNexus', atkName);
                await showDialogue('Opponent', line, { autoClose: true });
                await sleep(300);

                state.pHp -= atk.card.atk;
                log(`${atkName} hits your nexus for ${atk.card.atk}.`);
                spawnDamagePopup(document.getElementById('player-hp'), `-${atk.card.atk}`, 'dmg');
                shakeArena(atk.card.atk >= 4);
                updateBattleUI();

                const nexusLine = _enemyLine('nexusHit', atkName);
                await showDialogue('Opponent', nexusLine, { autoClose: true });

            // ── Strike: unit ──────────────────────────────────────────────
            } else {
                // Re-read the target slot — it may have changed since targeting
                const def = state.pBoard[targetIdx];
                if (!def || !def.card || def.card.hp <= 0) return; // target already dead

                const defName  = n(def);
                const defEl    = getSlotCard('player', targetIdx);
                const preDefHp = def.card.hp;

                // Dialogue
                const line = _enemyLine('attackUnit', 'Opponent', atkName, defName);
                await showDialogue('Opponent', line, { autoClose: true });
                await sleep(250);

                // whenAttacked triggers
                await triggerCardEvent('whenAttacked', def, { target: atk, slot: targetIdx, side: 'player', board: state.pBoard });
                await triggerCardEvent('whenAttacked', atk, { target: def,  slot: enemyIdx,  side: 'enemy',  board: state.eBoard });

                // ── Apply damage to defender ──────────────────────────────
                if (def.status?.invincible > 0) {
                    log(`INVINCIBLE: ${defName} blocked the hit!`);
                    spawnDamagePopup(defEl, 'BLOCK', 'buff');
                } else {
                    def.card.hp -= atk.card.atk;
                    spawnDamagePopup(defEl, `-${atk.card.atk}`, 'dmg');
                    spawnImpactBurst(defEl, '#f87171');
                    animateCard(defEl, 'animate-hit-flicker');
                }

                // ── Apply counter-damage to attacker ──────────────────────
                // Re-read attacker in case a whenAttacked ability changed it
                const atkAfter = attacker();
                if (!atkAfter) return; // attacker was somehow removed by an ability

                if (atkAfter.status?.invincible > 0) {
                    log(`INVINCIBLE: ${atkName} takes no counter damage!`);
                    spawnDamagePopup(atkEl, 'BLOCK', 'buff');
                } else {
                    atkAfter.card.hp -= def.card.atk;
                    if (def.card.atk > 0) spawnDamagePopup(atkEl, `-${def.card.atk}`, 'dmg');
                }

                // ── Resolve defender death ────────────────────────────────
                if (def.card.hp <= 0) {
                    const deadDefName = n(def); // capture name before nulling
                    log(`${deadDefName} is destroyed.`);
                    await triggerCardEvent('onDeath', def, { slot: targetIdx, side: 'player', board: state.pBoard });

                    // Berserk overflow into nexus
                    if (atkAfter && atkAfter.card.ability === 'berserk') {
                        const overflow = Math.max(0, atkAfter.card.atk - preDefHp);
                        if (overflow > 0) {
                            state.pHp -= overflow;
                            shakeArena(true);
                            log(`BERSERK OVERFLOW: ${overflow} DMG TO YOUR NEXUS.`);
                        }
                    }

                    // Animate then null the slot
                    if (def.card.hp <= 0) {
                        const deathLine = _enemyLine('playerUnitDied', atkName, deadDefName);
                        showDialogue('Opponent', deathLine, { autoClose: true }); // no await — continue
                        animateCardDeath(defEl, () => { state.pBoard[targetIdx] = null; });
                    }
                }

                // ── Resolve attacker death (from counter-damage) ──────────
                const atkFinal = attacker();
                if (atkFinal && atkFinal.card.hp <= 0) {
                    const deadAtkName = n(atkFinal); // capture before nulling
                    log(`${deadAtkName} is destroyed by counter-damage.`);
                    await triggerCardEvent('onDeath', atkFinal, { slot: enemyIdx, side: 'enemy', board: state.eBoard });
                    const deathLine = _enemyLine('unitDied', deadAtkName);
                    showDialogue('Opponent', deathLine, { autoClose: true }); // no await — continue
                    if (atkFinal.card.hp <= 0) {
                        animateCardDeath(atkEl, () => { state.eBoard[enemyIdx] = null; });
                    }
                }
            }
        };

        // First strike
        await performStrike();
        await sleep(500);

        // Haste2: second strike only if attacker is still alive on the board
        const atkCheck = attacker();
        if (atkCheck && atkCheck.card.hp > 0 && atkCheck.card.ability === 'haste2') {
            log(`HASTE2: ${n(atkCheck)} strikes again!`);
            await performStrike();
            await sleep(400);
        }

        // Status bookkeeping for this attacker — re-read from board
        const atkDone = attacker();
        if (atkDone) {
            atkDone.status.exhausted = true;
        }
    }

    // ── 6. Clear justPlayed on all remaining enemy units ──────────────────
    state.eBoard.forEach(u => { if (u) u.status.justPlayed = false; });

    // ── 7. Resource refresh ───────────────────────────────────────────────
    if (state.maxMana < 10) state.maxMana++;
    state.mana = state.maxMana;

    // ── 8. Reset player unit statuses ─────────────────────────────────────
    state.pBoard.forEach(u => {
        if (!u) return;
        if (u.status.invincible > 0) u.status.invincible--;
        if (u.status.shield > 0) u.status.shield--;
        if (u.status.reflect > 0) u.status.reflect--;
        if (u.status.invisible > 0) u.status.invisible--;
        u.status.exhausted  = false;
        u.status.justPlayed = false;
        if (u.status.silenced > 0) u.status.silenced--;
    });

    // ── 9. onTurnStart triggers for new turn ──────────────────────────────
    [
        { side: 'player', board: state.pBoard },
        { side: 'enemy',  board: state.eBoard }
    ].forEach(async group => {
        group.board.forEach(async (unit, idx) => {
            if (unit) await triggerCardEvent('onTurnStart', unit, { side: group.side, slot: idx, board: group.board });
        });
    });

    // ── 10. Draw + closing dialogue ───────────────────────────────────────
    draw();

    await sleep(200);
    const closingLine = _enemyLine('turnEnd', 'Opponent');
    await showDialogue('Opponent', closingLine, { autoClose: true });

    // ── 11. Final UI update and hand control back ─────────────────────────
    await sleep(650);
    updateBattleUI();
    log("YOUR CYCLE.");
    checkVictory();
    showTurnBanner('player');
}

/* ── Patch showScreen to toggle arena-active on body ─────── */
// This must come AFTER all other function definitions
(function patchShowScreen() {
    // Store original (already defined earlier in scripts.js)
    if (typeof showScreen !== 'function') return;
    const _orig = showScreen;
    window.showScreen = function(id) {
        _orig(id);
        if (id === 'arena') {
            document.body.classList.add('arena-active');
        } else {
            document.body.classList.remove('arena-active');
            // Dismiss any open dialogue when leaving arena
            const box = document.getElementById('vn-dialogue');
            if (box) box.classList.remove('vn-visible');
        }
    };
})();

        window.onload = async () => {
            await loadCards();
            showScreen('vault');
            // If you want to start directly in battle for testing, uncomment below:
            // startBattle();
        };
/* ══════════════════════════════════════════════════════════════
   ARENA & ABILITY ANIMATION ENHANCEMENTS v2
   Paste at bottom of scripts.js (after window.onload block)
   ══════════════════════════════════════════════════════════════ */

// ── Ability ring flash around a card element ─────────────────
function spawnAbilityRing(el, type = 'default') {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = `ability-ring ${type}`;
    ring.style.cssText = `
        left:   ${rect.left   - 6}px;
        top:    ${rect.top    - 6}px;
        width:  ${rect.width  + 12}px;
        height: ${rect.height + 12}px;
    `;
    document.body.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
}

// ── Heal ripple rings ────────────────────────────────────────
function spawnHealRipple(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < 3; i++) {
        const ripple = document.createElement('div');
        ripple.className = 'heal-ripple';
        const size = rect.width + 20;
        ripple.style.cssText = `
            left:   ${rect.left + rect.width / 2 - size / 2}px;
            top:    ${rect.top  + rect.height / 2 - size / 2}px;
            width:  ${size}px;
            height: ${size}px;
            animation-delay: ${i * 0.15}s;
        `;
        document.body.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }
}

// ── Shield block burst (green square particles) ──────────────
function spawnShieldBurst(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const dist  = 30 + Math.random() * 40;
        const p = document.createElement('div');
        p.className = 'shield-burst-particle';
        p.style.cssText = `
            left: ${cx - 4}px; top: ${cy - 4}px;
            --px: ${Math.cos(angle) * dist}px;
            --py: ${Math.sin(angle) * dist}px;
            animation-duration: ${0.4 + Math.random() * 0.3}s;
            background: ${i % 2 === 0 ? '#4ade80' : '#86efac'};
        `;
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
    }
}

// ── Fire particles (berserk / fire attacks) ──────────────────
function spawnFireParticles(el, count = 12) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#ef4444'];
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'fire-particle';
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top  + rect.height * 0.6 + Math.random() * rect.height * 0.4;
        p.style.cssText = `
            left: ${x}px; top: ${y}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            animation-duration: ${0.4 + Math.random() * 0.4}s;
            animation-delay: ${Math.random() * 0.2}s;
            width: ${4 + Math.random() * 6}px;
            height: ${8 + Math.random() * 10}px;
            box-shadow: 0 0 6px currentColor;
        `;
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
    }
}

// ── Death shockwave ring ─────────────────────────────────────
function spawnDeathShockwave(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) + 20;
    const wave = document.createElement('div');
    wave.className = 'death-shockwave';
    wave.style.cssText = `
        left:   ${rect.left + rect.width / 2 - size / 2}px;
        top:    ${rect.top  + rect.height / 2 - size / 2}px;
        width:  ${size}px;
        height: ${size}px;
    `;
    document.body.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove());
}

// ── Mana sparkle burst around mana element ───────────────────
function spawnManaSparkles(el, count = 10) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = 20 + Math.random() * 35;
        const sp = document.createElement('div');
        sp.className = 'mana-sparkle';
        sp.style.cssText = `
            left: ${cx - 2.5}px; top: ${cy - 2.5}px;
            --sx: ${Math.cos(angle) * dist}px;
            --sy: ${Math.sin(angle) * dist}px;
            --sr: ${-90 + Math.random() * 180}deg;
            animation-duration: ${0.5 + Math.random() * 0.4}s;
            animation-delay:    ${Math.random() * 0.1}s;
            background: ${Math.random() > 0.5 ? '#818cf8' : '#a5b4fc'};
        `;
        document.body.appendChild(sp);
        sp.addEventListener('animationend', () => sp.remove());
    }
}

// ── Snipe crosshair overlay on target ────────────────────────
function spawnSnipeCrosshair(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ch = document.createElement('div');
    ch.className = 'snipe-crosshair';
    ch.style.cssText = `
        left: ${rect.left + rect.width / 2 - 25}px;
        top:  ${rect.top  + rect.height / 2 - 25}px;
    `;
    document.body.appendChild(ch);
    ch.addEventListener('animationend', () => ch.remove());
}

// ── Silence drape overlay ────────────────────────────────────
function spawnSilenceOverlay(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ov = document.createElement('div');
    ov.className = 'silence-overlay';
    ov.style.cssText = `
        left:   ${rect.left}px;
        top:    ${rect.top}px;
        width:  ${rect.width}px;
        height: ${rect.height}px;
    `;
    ov.textContent = '🚫';
    document.body.appendChild(ov);
    ov.addEventListener('animationend', () => ov.remove());
}

// ── Drain orbs (steal / drain ATK effects) ───────────────────
function spawnDrainOrbs(srcEl, dstEl, count = 6) {
    if (!srcEl || !dstEl) return;
    const srcRect = srcEl.getBoundingClientRect();
    const dstRect = dstEl.getBoundingClientRect();
    const sx = srcRect.left + srcRect.width  / 2;
    const sy = srcRect.top  + srcRect.height / 2;
    const dx = dstRect.left + dstRect.width  / 2;
    const dy = dstRect.top  + dstRect.height / 2;

    for (let i = 0; i < count; i++) {
        const orb = document.createElement('div');
        orb.className = 'drain-orb';
        orb.style.cssText = `
            left: ${sx - 5}px;
            top:  ${sy - 5}px;
            --dx: ${dx - sx + (Math.random() - 0.5) * 30}px;
            --dy: ${dy - sy + (Math.random() - 0.5) * 30}px;
            animation-delay:    ${i * 0.06}s;
            animation-duration: ${0.45 + Math.random() * 0.2}s;
        `;
        document.body.appendChild(orb);
        orb.addEventListener('animationend', () => orb.remove());
    }
}

// ── Combo label popup ─────────────────────────────────────────
let _comboCount = 0;
let _comboTimer = null;
function spawnComboLabel(el, label = null) {
    if (!el) return;
    _comboCount++;
    clearTimeout(_comboTimer);
    _comboTimer = setTimeout(() => { _comboCount = 0; }, 3000);

    const rect = el.getBoundingClientRect();
    const lbl = document.createElement('div');
    lbl.className = 'combo-label';
    lbl.textContent = label || (_comboCount > 1 ? `${_comboCount}x COMBO!` : 'CRITICAL!');
    lbl.style.cssText = `
        left: ${rect.left + rect.width / 2 - 80}px;
        top:  ${rect.top  - 60}px;
    `;
    document.body.appendChild(lbl);
    lbl.addEventListener('animationend', () => lbl.remove());
}

// ── Screen flash overlay for big hits ────────────────────────
function flashScreen() {
    const fl = document.createElement('div');
    fl.className = 'screen-flash-overlay';
    document.body.appendChild(fl);
    fl.addEventListener('animationend', () => fl.remove());
}

// ── Vignette pulse ────────────────────────────────────────────
function flashVignette(color = 'red') {
    const vig = document.createElement('div');
    vig.className = `battle-vignette ${color}`;
    document.body.appendChild(vig);
    vig.addEventListener('animationend', () => vig.remove());
}

// ── Lightning SVG arc between two elements ───────────────────
function spawnLightningArc(srcEl, dstEl, color = '#818cf8') {
    if (!srcEl || !dstEl) return;
    const srcRect = srcEl.getBoundingClientRect();
    const dstRect = dstEl.getBoundingClientRect();

    const x1 = srcRect.left + srcRect.width  / 2;
    const y1 = srcRect.top  + srcRect.height / 2;
    const x2 = dstRect.left + dstRect.width  / 2;
    const y2 = dstRect.top  + dstRect.height / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.className.baseVal = 'lightning-canvas';
    svg.style.zIndex = '9996';

    // Build jagged path
    const segments = 8;
    const points = [[x1, y1]];
    for (let i = 1; i < segments; i++) {
        const t  = i / segments;
        const mx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 40;
        const my = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 40;
        points.push([mx, my]);
    }
    points.push([x2, y2]);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    path.setAttribute('points', points.map(p => p.join(',')).join(' '));
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('opacity', '0.9');
    path.style.filter = `drop-shadow(0 0 4px ${color})`;

    svg.appendChild(path);
    document.body.appendChild(svg);

    // Flicker and remove
    let flickers = 0;
    const flicker = setInterval(() => {
        path.setAttribute('opacity', Math.random() > 0.4 ? '0.9' : '0.2');
        // Jitter the middle points
        const pts = points.slice();
        pts.slice(1, -1).forEach(p => {
            p[0] += (Math.random() - 0.5) * 12;
            p[1] += (Math.random() - 0.5) * 12;
        });
        path.setAttribute('points', pts.map(p => p.join(',')).join(' '));
        if (++flickers > 5) {
            clearInterval(flicker);
            svg.remove();
        }
    }, 60);
}

// ── Spawn arena ambient idle motes on battle start ────────────
function startArenaMotes() {
    if (document.querySelectorAll('.arena-mote').length > 0) return;
    const colors = ['#6366f1','#818cf8','#a855f7','#f0abfc','#38bdf8'];
    for (let i = 0; i < 20; i++) {
        const mote = document.createElement('div');
        mote.className = 'arena-mote';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const dur = 4 + Math.random() * 8;
        const left = Math.random() * 100;
        const bottom = 10 + Math.random() * 80;
        mote.style.cssText = `
            left:   ${left}vw;
            bottom: ${bottom}vh;
            background: ${color};
            box-shadow: 0 0 6px ${color};
            --mx: ${(Math.random() - 0.5) * 60}px;
            animation-duration: ${dur}s;
            animation-delay: ${Math.random() * dur}s;
            opacity: 0;
        `;
        document.body.appendChild(mote);
        // Remove mote when leaving arena
        mote.dataset.arenaFx = 'true';
    }
}

function clearArenaMotes() {
    document.querySelectorAll('[data-arena-fx]').forEach(el => el.remove());
}

// ── spawnRollPopup (improved) ─────────────────────────────────
function spawnRollPopup(el, rolls, best, stat = 'atk') {
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Remove any existing popup on this card
    const existing = document.querySelector('.roll-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'roll-popup';
    popup.style.cssText = `
        left: ${rect.left + rect.width / 2 - 55}px;
        top:  ${rect.top  - 85}px;
    `;

    const diceHTML = rolls.map((r, i) => {
        const isBest = r === best && rolls.filter(x => x === best).indexOf(r) === i;
        return `<div class="roll-die ${isBest ? 'best' : ''}" style="animation-delay:${i * 0.07}s">${r}</div>`;
    }).join('');

    popup.innerHTML = `
        <div class="roll-popup-dice">${diceHTML}</div>
        <div class="roll-result">+${best} ${stat.toUpperCase()}</div>
    `;

    document.body.appendChild(popup);

    // Animate out after 1.5s
    setTimeout(() => {
        popup.style.animation = 'roll-popup-out 0.35s ease-in forwards';
        popup.addEventListener('animationend', () => popup.remove());
    }, 1500);
}

// ── Check nexus HP and add danger class ───────────────────────
function updateNexusDanger() {
    const pHpEl = document.getElementById('player-hp');
    const eHpEl = document.getElementById('enemy-hp');
    if (pHpEl) {
        const ph = parseInt(pHpEl.textContent);
        if (ph <= 8) pHpEl.classList.add('nexus-danger');
        else pHpEl.classList.remove('nexus-danger');
    }
    if (eHpEl) {
        const eh = parseInt(eHpEl.textContent);
        if (eh <= 8) eHpEl.classList.add('nexus-danger');
        else eHpEl.classList.remove('nexus-danger');
    }
}

// ── Patch animateCardDeath to add extra effects ───────────────
const _origAnimateCardDeath = animateCardDeath;
animateCardDeath = function(el, onNullCallback) {
    if (el) {
        spawnDeathShockwave(el);
        spawnImpactBurst(el, '#c084fc'); // purple death particles
        spawnImpactBurst(el, '#f87171');
    }
    _origAnimateCardDeath(el, onNullCallback);
};

// ── Patch spawnImpactBurst to add vignette on big hits ────────
const _origSpawnImpact = spawnImpactBurst;
spawnImpactBurst = function(el, color = '#f87171') {
    _origSpawnImpact(el, color);
    // Red vignette for damage bursts
    if (color === '#f87171') {
        flashVignette('red');
    }
};

// ── Patch shakeArena to add screen flash on intense hits ──────
const _origShakeArena = shakeArena;
shakeArena = function(intense = false) {
    _origShakeArena(intense);
    if (intense) {
        flashScreen();
        flashVignette('red');
    }
};

// ── Patch updateBattleUI to track nexus danger state ─────────
const _origUpdateBattleUI = updateBattleUI;
updateBattleUI = async function() {
    await _origUpdateBattleUI();
    updateNexusDanger();
    updateCardStatusVisuals();
};

// ── Update card status visuals (invisible, berserk) ──────────
function updateCardStatusVisuals() {
    ['player', 'enemy'].forEach(side => {
        const board = side === 'player' ? state.pBoard : state.eBoard;
        board.forEach((unit, i) => {
            const el = getSlotCard(side, i);
            if (!el || !unit) return;
            // Invisible state
            if (unit.status?.invisible > 0) {
                el.classList.add('is-invisible-state');
            } else {
                el.classList.remove('is-invisible-state');
            }
        });
    });
}

// ── Patch applyCardEffect to add visual FX per ability type ──
const _origApplyCardEffect = applyCardEffect;
applyCardEffect = async function(effect, unit, context = {}) {
    const result = await _origApplyCardEffect(effect, unit, context);

    const side = context.side;
    const slot = context.slot;
    const cardEl = (side !== undefined && slot !== undefined) ? getSlotCard(side, slot) : null;

    switch (effect.type) {
        case 'healSelf':
        case 'healNexus':
        case 'healAllies': {
            if (cardEl) {
                spawnHealRipple(cardEl);
                spawnAbilityRing(cardEl, 'heal');
            }
            const hpEl = effect.type === 'healNexus'
                ? document.getElementById('player-hp')
                : null;
            if (hpEl) spawnHealRipple(hpEl);
            break;
        }
        case 'attackUpSelf':
        case 'hpUpSelf': {
            if (cardEl) spawnAbilityRing(cardEl, 'buff');
            break;
        }
        case 'dealDamageAllEnemies': {
            const oppSide = side === 'player' ? 'enemy' : 'player';
            const oppBoard = context.opponentBoard || (side === 'player' ? state.eBoard : state.pBoard);
            oppBoard.forEach((u, i) => {
                if (!u) return;
                const targetEl = getSlotCard(oppSide, i);
                if (targetEl) {
                    spawnImpactBurst(targetEl, '#f87171');
                    spawnAbilityRing(targetEl, 'dmg');
                }
            });
            if (cardEl) spawnFireParticles(cardEl, 8);
            break;
        }
        case 'curseAllEnemies': {
            const oppSide2 = side === 'player' ? 'enemy' : 'player';
            const oppBoard2 = context.opponentBoard || (side === 'player' ? state.eBoard : state.pBoard);
            oppBoard2.forEach((u, i) => {
                if (!u) return;
                const targetEl = getSlotCard(oppSide2, i);
                if (targetEl) spawnAbilityRing(targetEl, 'curse');
            });
            break;
        }
        case 'silenceTarget':
        case 'silenceRandomEnemy': {
            const victimSide = context.side === 'player' ? 'enemy' : 'player';
            const victimIdx  = context.targetIdx;
            if (victimIdx !== undefined) {
                const victimEl = getSlotCard(victimSide, victimIdx);
                if (victimEl) {
                    spawnSilenceOverlay(victimEl);
                    spawnAbilityRing(victimEl, 'silence');
                }
            }
            break;
        }
        case 'stealAttack':
        case 'stealAttackFromAll': {
            if (cardEl && context.target) {
                const targetBoard  = side === 'player' ? state.eBoard : state.pBoard;
                const targetSide   = side === 'player' ? 'enemy' : 'player';
                const targetIdx    = targetBoard.indexOf(context.target);
                if (targetIdx !== -1) {
                    const targetEl = getSlotCard(targetSide, targetIdx);
                    spawnDrainOrbs(targetEl, cardEl, 8);
                }
            }
            break;
        }
        case 'gainMana': {
            const manaEl = document.getElementById('mana-text');
            if (manaEl) spawnManaSparkles(manaEl, 12);
            break;
        }
        case 'snipeDamage': {
            if (context.target) {
                const snipeSide = side === 'player' ? 'enemy' : 'player';
                const snipeBoard = snipeSide === 'enemy' ? state.eBoard : state.pBoard;
                const snipeIdx   = snipeBoard.indexOf(context.target);
                if (snipeIdx !== -1) {
                    const snipeEl = getSlotCard(snipeSide, snipeIdx);
                    spawnSnipeCrosshair(snipeEl);
                    await delay(200);
                    spawnImpactBurst(snipeEl, '#f87171');
                }
            }
            break;
        }
        case 'damageRandomEnemy': {
            const rndSide = side === 'player' ? 'enemy' : 'player';
            const rndBoard = rndSide === 'enemy' ? state.eBoard : state.pBoard;
            if (context.target) {
                const rndIdx = rndBoard.indexOf(context.target);
                if (rndIdx !== -1) {
                    const rndEl = getSlotCard(rndSide, rndIdx);
                    spawnLightningArc(cardEl, rndEl, '#818cf8');
                    spawnAbilityRing(rndEl, 'dmg');
                }
            }
            break;
        }
        case 'applyShield': {
            if (cardEl) {
                spawnShieldBurst(cardEl);
                spawnAbilityRing(cardEl, 'heal');
            }
            break;
        }
        case 'applyReflect': {
            if (cardEl) {
                spawnAbilityRing(cardEl, 'buff');
                animateCard(cardEl, 'animate-reflect');
            }
            break;
        }
        case 'nexusHpToPowerUp': {
            if (cardEl) spawnFireParticles(cardEl, 10);
            break;
        }
        case 'drawCard': {
            spawnManaSparkles(document.getElementById('player-hp') || document.body, 6);
            break;
        }
    }

    return result;
};

// ── Haste double-strike visual ────────────────────────────────
const _origHandleStrike = handleStrike;
handleStrike = async function(pIdx, eIdx) {
    return _origHandleStrike(pIdx, eIdx);
};

// ── Hook into arena show/hide for ambient effects ─────────────
const _origShowScreenPatch = window.showScreen;
window.showScreen = function(id) {
    _origShowScreenPatch(id);
    if (id === 'arena') {
        setTimeout(startArenaMotes, 500);
    } else {
        clearArenaMotes();
    }
};

// ── Enhanced handleStrike: adds haste glow ────────────────────
// Intercept via a post-drop check so we don't break the chain
document.addEventListener('drop', function(e) {
    // After a drop, briefly check if the attacker has haste and highlight
    setTimeout(() => {
        state.pBoard.forEach((u, i) => {
            if (!u) return;
            const el = getSlotCard('player', i);
            if (!el) return;
            if (u.card.ability === 'haste2' && !u.status.exhausted) {
                el.classList.add('animate-haste');
                setTimeout(() => el.classList.remove('animate-haste'), 500);
            }
        });
    }, 50);
});

console.log('[FX v2] Arena & ability animations loaded.');