<?php
// منطق تبدیل بین جدول‌های MySQL و شکل DatabaseSnapshot (همان چیزی که فرانت و seed.php هم
// می‌شناسند) — هم api/db.php (روی درخواست HTTP) و هم api/seed.php (از خط فرمان) از همین
// توابع استفاده می‌کنند تا منطق یک‌جا باشد.

function bool_from_db($v): bool
{
    return (int) $v === 1;
}

function decode_json_column($v)
{
    if ($v === null) return null;
    return json_decode($v, true);
}

function read_snapshot(PDO $pdo): array
{
    $dishRows = $pdo->query('SELECT * FROM dishes ORDER BY name')->fetchAll();

    $ingredientsByDish = [];
    $ingRows = $pdo->query('SELECT * FROM dish_ingredients ORDER BY dish_id, sort_order, id')->fetchAll();
    foreach ($ingRows as $row) {
        $ingredientsByDish[$row['dish_id']][] = [
            'name' => $row['name'],
            'quantity' => (float) $row['quantity'],
            'unit' => $row['unit'],
            'unitPrice' => $row['unit_price'] !== null ? (float) $row['unit_price'] : null,
            'lineTotal' => $row['line_total'] !== null ? (float) $row['line_total'] : null,
        ];
    }

    $dishes = array_map(function ($d) use ($ingredientsByDish) {
        return [
            'id' => $d['id'],
            'name' => $d['name'],
            'category' => $d['category'],
            'macro' => decode_json_column($d['macro']),
            'costPerServing' => $d['cost_per_serving'] !== null ? (float) $d['cost_per_serving'] : null,
            'costSource' => $d['cost_source'],
            'priceVarianceFlag' => bool_from_db($d['price_variance_flag']),
            'needsPrice' => bool_from_db($d['needs_price']),
            'eventsUsedIn' => decode_json_column($d['events_used_in']) ?? [],
            'ingredients' => $ingredientsByDish[$d['id']] ?? null,
            'ingredientsCostTotal' => $d['ingredients_cost_total'] !== null ? (float) $d['ingredients_cost_total'] : null,
            'referencePortionGrams' => (int) $d['reference_portion_grams'],
            'portionSource' => $d['portion_source'],
            'needsPortionEstimate' => bool_from_db($d['needs_portion_estimate']),
            'dietaryTags' => decode_json_column($d['dietary_tags']) ?? [],
            'dietaryTagsVerified' => bool_from_db($d['dietary_tags_verified']),
            'isBreakfastItem' => bool_from_db($d['is_breakfast_item']),
            'wasteRisk' => $d['waste_risk'],
            'wasteRiskVerified' => bool_from_db($d['waste_risk_verified']),
            'observedCoveragePercent' => $d['observed_coverage_percent'] !== null ? (float) $d['observed_coverage_percent'] : null,
            'observedEventsRecorded' => (int) $d['observed_events_recorded'],
            'nutrition' => decode_json_column($d['nutrition']),
            'needsNutritionReview' => bool_from_db($d['needs_nutrition_review']),
            'proteinSource' => $d['protein_source'],
            'proteinSourceVerified' => bool_from_db($d['protein_source_verified']),
            'defaultCookingMethod' => $d['default_cooking_method'],
            'defaultCookingMethodVerified' => bool_from_db($d['default_cooking_method_verified']),
        ];
    }, $dishRows);

    $planRow = $pdo->query('SELECT * FROM plan WHERE id = 1')->fetch();
    $plan = $planRow === false ? null : [
        'guestCount' => (int) $planRow['guest_count'],
        'perPersonBudget' => (float) $planRow['per_person_budget'],
        'confidenceFactor' => (float) $planRow['confidence_factor'],
        'expectedAttendanceRate' => (float) $planRow['expected_attendance_rate'],
        'mealType' => $planRow['meal_type'],
        'categoryBudgetShare' => decode_json_column($planRow['category_budget_share']),
        'selectedItems' => decode_json_column($planRow['selected_items']) ?? [],
        'dishConstraints' => decode_json_column($planRow['dish_constraints']) ?? new stdClass(),
    ];

    $settingsRow = $pdo->query('SELECT * FROM settings WHERE id = 1')->fetch();
    $settings = $settingsRow === false ? null : [
        'tierWeights' => decode_json_column($settingsRow['tier_weights']),
        'defaultCoverageByTier' => decode_json_column($settingsRow['default_coverage_by_tier']),
        'tierCostCeilingShare' => decode_json_column($settingsRow['tier_cost_ceiling_share']),
        'confidenceFactorByWasteRisk' => decode_json_column($settingsRow['confidence_factor_by_waste_risk']),
        'nutritionTargets' => decode_json_column($settingsRow['nutrition_targets']),
        'cookingMethodCapacity' => decode_json_column($settingsRow['cooking_method_capacity']),
        'menuOptimizer' => decode_json_column($settingsRow['menu_optimizer']),
    ];

    $ingredientPriceLog = [];
    $logRows = $pdo->query('SELECT * FROM ingredient_price_log ORDER BY ingredient_name, changed_at DESC, id DESC')->fetchAll();
    foreach ($logRows as $row) {
        $ingredientPriceLog[$row['ingredient_name']][] = [
            'price' => (float) $row['price'],
            'changedAt' => $row['changed_at'],
        ];
    }

    $customIngredients = [];
    $customRows = $pdo->query('SELECT * FROM custom_ingredients')->fetchAll();
    foreach ($customRows as $row) {
        $customIngredients[$row['name']] = [
            'unit' => $row['unit'],
            'group' => $row['category_group'],
        ];
    }

    return [
        'fileFormatVersion' => 1,
        'savedAt' => gmdate('c'),
        'dishes' => $dishes,
        'plan' => $plan,
        'settings' => $settings,
        'ingredientPriceLog' => (object) $ingredientPriceLog,
        'customIngredients' => (object) $customIngredients,
    ];
}

function write_snapshot(PDO $pdo, array $snapshot): void
{
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM dish_ingredients');
        $pdo->exec('DELETE FROM dishes');

        $insertDish = $pdo->prepare(
            'INSERT INTO dishes (
                id, name, category, macro, cost_per_serving, cost_source, price_variance_flag, needs_price,
                events_used_in, ingredients_cost_total, reference_portion_grams, portion_source,
                needs_portion_estimate, dietary_tags, dietary_tags_verified, is_breakfast_item, waste_risk,
                waste_risk_verified, observed_coverage_percent, observed_events_recorded, nutrition,
                needs_nutrition_review, protein_source, protein_source_verified, default_cooking_method,
                default_cooking_method_verified
            ) VALUES (
                :id, :name, :category, :macro, :cost_per_serving, :cost_source, :price_variance_flag, :needs_price,
                :events_used_in, :ingredients_cost_total, :reference_portion_grams, :portion_source,
                :needs_portion_estimate, :dietary_tags, :dietary_tags_verified, :is_breakfast_item, :waste_risk,
                :waste_risk_verified, :observed_coverage_percent, :observed_events_recorded, :nutrition,
                :needs_nutrition_review, :protein_source, :protein_source_verified, :default_cooking_method,
                :default_cooking_method_verified
            )',
        );
        $insertIngredient = $pdo->prepare(
            'INSERT INTO dish_ingredients (dish_id, sort_order, name, quantity, unit, unit_price, line_total)
             VALUES (:dish_id, :sort_order, :name, :quantity, :unit, :unit_price, :line_total)',
        );

        foreach ($snapshot['dishes'] as $d) {
            $insertDish->execute([
                ':id' => $d['id'],
                ':name' => $d['name'],
                ':category' => $d['category'],
                ':macro' => json_encode($d['macro'], JSON_UNESCAPED_UNICODE),
                ':cost_per_serving' => $d['costPerServing'],
                ':cost_source' => $d['costSource'],
                ':price_variance_flag' => $d['priceVarianceFlag'] ? 1 : 0,
                ':needs_price' => $d['needsPrice'] ? 1 : 0,
                ':events_used_in' => json_encode($d['eventsUsedIn'] ?? [], JSON_UNESCAPED_UNICODE),
                ':ingredients_cost_total' => $d['ingredientsCostTotal'],
                ':reference_portion_grams' => $d['referencePortionGrams'],
                ':portion_source' => $d['portionSource'],
                ':needs_portion_estimate' => $d['needsPortionEstimate'] ? 1 : 0,
                ':dietary_tags' => json_encode($d['dietaryTags'] ?? [], JSON_UNESCAPED_UNICODE),
                ':dietary_tags_verified' => $d['dietaryTagsVerified'] ? 1 : 0,
                ':is_breakfast_item' => $d['isBreakfastItem'] ? 1 : 0,
                ':waste_risk' => $d['wasteRisk'],
                ':waste_risk_verified' => $d['wasteRiskVerified'] ? 1 : 0,
                ':observed_coverage_percent' => $d['observedCoveragePercent'],
                ':observed_events_recorded' => $d['observedEventsRecorded'],
                ':nutrition' => json_encode($d['nutrition'], JSON_UNESCAPED_UNICODE),
                ':needs_nutrition_review' => $d['needsNutritionReview'] ? 1 : 0,
                ':protein_source' => $d['proteinSource'],
                ':protein_source_verified' => $d['proteinSourceVerified'] ? 1 : 0,
                ':default_cooking_method' => $d['defaultCookingMethod'],
                ':default_cooking_method_verified' => $d['defaultCookingMethodVerified'] ? 1 : 0,
            ]);

            if (!empty($d['ingredients'])) {
                foreach (array_values($d['ingredients']) as $i => $ing) {
                    $insertIngredient->execute([
                        ':dish_id' => $d['id'],
                        ':sort_order' => $i,
                        ':name' => $ing['name'],
                        ':quantity' => $ing['quantity'],
                        ':unit' => $ing['unit'],
                        ':unit_price' => $ing['unitPrice'] ?? null,
                        ':line_total' => $ing['lineTotal'] ?? null,
                    ]);
                }
            }
        }

        $pdo->exec('DELETE FROM ingredient_price_log');
        $insertLog = $pdo->prepare(
            'INSERT INTO ingredient_price_log (ingredient_name, price, changed_at) VALUES (:name, :price, :changed_at)',
        );
        foreach ((array) $snapshot['ingredientPriceLog'] as $name => $entries) {
            foreach ((array) $entries as $entry) {
                $entry = (array) $entry;
                $insertLog->execute([
                    ':name' => $name,
                    ':price' => $entry['price'],
                    ':changed_at' => $entry['changedAt'],
                ]);
            }
        }

        $pdo->exec('DELETE FROM custom_ingredients');
        $insertCustom = $pdo->prepare(
            'INSERT INTO custom_ingredients (name, unit, category_group) VALUES (:name, :unit, :group)',
        );
        foreach ((array) $snapshot['customIngredients'] as $name => $def) {
            $def = (array) $def;
            $insertCustom->execute([':name' => $name, ':unit' => $def['unit'], ':group' => $def['group']]);
        }

        $plan = $snapshot['plan'];
        $pdo->exec('DELETE FROM plan');
        $insertPlan = $pdo->prepare(
            'INSERT INTO plan (
                id, guest_count, per_person_budget, confidence_factor, expected_attendance_rate, meal_type,
                category_budget_share, selected_items, dish_constraints
            ) VALUES (1, :guest_count, :per_person_budget, :confidence_factor, :expected_attendance_rate, :meal_type,
                :category_budget_share, :selected_items, :dish_constraints)',
        );
        $insertPlan->execute([
            ':guest_count' => $plan['guestCount'],
            ':per_person_budget' => $plan['perPersonBudget'],
            ':confidence_factor' => $plan['confidenceFactor'],
            ':expected_attendance_rate' => $plan['expectedAttendanceRate'],
            ':meal_type' => $plan['mealType'],
            ':category_budget_share' => json_encode($plan['categoryBudgetShare'], JSON_UNESCAPED_UNICODE),
            ':selected_items' => json_encode($plan['selectedItems'] ?? [], JSON_UNESCAPED_UNICODE),
            ':dish_constraints' => json_encode($plan['dishConstraints'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
        ]);

        $settings = $snapshot['settings'];
        $pdo->exec('DELETE FROM settings');
        $insertSettings = $pdo->prepare(
            'INSERT INTO settings (
                id, tier_weights, default_coverage_by_tier, tier_cost_ceiling_share,
                confidence_factor_by_waste_risk, nutrition_targets, cooking_method_capacity, menu_optimizer
            ) VALUES (1, :tier_weights, :default_coverage_by_tier, :tier_cost_ceiling_share,
                :confidence_factor_by_waste_risk, :nutrition_targets, :cooking_method_capacity, :menu_optimizer)',
        );
        $insertSettings->execute([
            ':tier_weights' => json_encode($settings['tierWeights'], JSON_UNESCAPED_UNICODE),
            ':default_coverage_by_tier' => json_encode($settings['defaultCoverageByTier'], JSON_UNESCAPED_UNICODE),
            ':tier_cost_ceiling_share' => json_encode($settings['tierCostCeilingShare'], JSON_UNESCAPED_UNICODE),
            ':confidence_factor_by_waste_risk' => json_encode($settings['confidenceFactorByWasteRisk'], JSON_UNESCAPED_UNICODE),
            ':nutrition_targets' => json_encode($settings['nutritionTargets'], JSON_UNESCAPED_UNICODE),
            ':cooking_method_capacity' => json_encode($settings['cookingMethodCapacity'], JSON_UNESCAPED_UNICODE),
            ':menu_optimizer' => json_encode($settings['menuOptimizer'], JSON_UNESCAPED_UNICODE),
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
