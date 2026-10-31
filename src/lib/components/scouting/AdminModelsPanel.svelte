<script>
  // Scouting Admin > Extra: the legacy Data Scout fuel calibration model and the Quick Scout
  // alliance attribution model. Display only; the layout loads the numbers and saves the toggle.
  export let smartFuelModel = {};
  export let quickScoutModel = {};
  export let saving = false;
  export let onToggleSmartFuel = () => {};
</script>

<details class="role-accordion" open>
  <summary class="role-summary">
    <span class="role-summary-title">Legacy Data Scout Fuel Calibration</span>
  </summary>
  <div class="role-body">
    <div class="smart-toolbar">
      <div class="smart-toggle-copy">
        <div class="smart-title">Smart regression model</div>
        <div class="text-muted">Fits per-scout adjustment factors to reduce blue alliance fuel residual.</div>
      </div>
      <button class="btn btn-secondary" disabled={saving} on:click={onToggleSmartFuel}>
        {saving ? 'Saving...' : smartFuelModel.enabled ? 'Disable Algorithm' : 'Enable Algorithm'}
      </button>
    </div>

    <div class="smart-stats">
      <div class="smart-stat">
        <span>Status</span><strong>{smartFuelModel.enabled ? 'Enabled' : 'Disabled'}</strong>
      </div>
      <div class="smart-stat"><span>Matches Fit</span><strong>{smartFuelModel.match_count || 0}</strong></div>
      <div class="smart-stat"><span>Residual RMSE</span><strong>{smartFuelModel.residual_rmse || 0}</strong></div>
      <div class="smart-stat"><span>Residual MAE</span><strong>{smartFuelModel.residual_mae || 0}</strong></div>
    </div>

    {#if smartFuelModel.warning}
      <div class="status-message status-warning">{smartFuelModel.warning}</div>
    {/if}

    <div class="table-wrap">
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Scout</th>
              <th>Adjustment Factor</th>
              <th>Balanced Ball Count</th>
              <th>Shooting Time (s)</th>
              <th>Estimated BPS</th>
              <th>Residual RMSE</th>
              <th>Residual MAE</th>
              <th>Residual Bias</th>
              <th>Sample Matches</th>
            </tr>
          </thead>
          <tbody>
            {#if !smartFuelModel.by_scout?.length}
              <tr>
                <td colspan="9" class="empty">No scout calibration rows available yet.</td>
              </tr>
            {:else}
              {#each smartFuelModel.by_scout as row}
                <tr>
                  <td data-label="Scout">{row.scout_name || row.scout_id}</td>
                  <td data-label="Adjustment Factor">{row.adjustment_factor}</td>
                  <td data-label="Balanced Ball Count">{row.balanced_ball_count || 0}</td>
                  <td data-label="Shooting Time (s)">{row.shooting_seconds || 0}</td>
                  <td data-label="Estimated BPS">{row.estimated_bps || 0}</td>
                  <td data-label="Residual RMSE">{row.residual_rmse}</td>
                  <td data-label="Residual MAE">{row.residual_mae}</td>
                  <td data-label="Residual Bias">{row.residual_bias}</td>
                  <td data-label="Sample Matches">{row.sample_matches}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</details>
{#if quickScoutModel.alliance_count > 0 || quickScoutModel.by_team.length}
  <details class="role-accordion" open>
    <summary class="role-summary">
      <span class="role-summary-title">Quick Scouting Alliance Attribution</span>
    </summary>
    <div class="role-body">
      <div class="text-muted">
        Regresses Quick Scout's shooting/climbed/defense/broken signals against each match's real alliance score (from
        The Blue Alliance) to estimate what share each robot contributed - an OPR-like attribution built from data
        anyone can collect. Defense reduces the <em>opponent's</em>
        score, not this alliance's own total, so its weight will likely stay near zero or noisy - that's an expected limitation
        of a same-alliance model, not a bug.
      </div>

      <div class="smart-stats">
        <div class="smart-stat">
          <span>Alliance-Matches Fit</span><strong>{quickScoutModel.alliance_count || 0}</strong>
        </div>
        <div class="smart-stat"><span>Residual RMSE</span><strong>{quickScoutModel.residual_rmse || 0}</strong></div>
        <div class="smart-stat"><span>Residual MAE</span><strong>{quickScoutModel.residual_mae || 0}</strong></div>
      </div>

      {#if quickScoutModel.warning}
        <div class="status-message status-warning">{quickScoutModel.warning}</div>
      {/if}

      {#if quickScoutModel.coefficients}
        <div class="smart-stats">
          <div class="smart-stat">
            <span>Pts / Shooting Sec</span><strong>{quickScoutModel.coefficients.shooting_seconds}</strong>
          </div>
          <div class="smart-stat">
            <span>Pts / Climbed</span><strong>{quickScoutModel.coefficients.climbed}</strong>
          </div>
          <div class="smart-stat">
            <span>Pts / Defense</span><strong>{quickScoutModel.coefficients.defense}</strong>
          </div>
          <div class="smart-stat"><span>Pts / Broken</span><strong>{quickScoutModel.coefficients.broken}</strong></div>
        </div>
      {/if}

      <div class="table-wrap">
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Avg % of Alliance Score</th>
                <th>Avg Contribution (pts)</th>
                <th>Matches Scored</th>
              </tr>
            </thead>
            <tbody>
              {#if !quickScoutModel.by_team?.length}
                <tr>
                  <td colspan="4" class="empty">No Quick Scout attribution rows available yet.</td>
                </tr>
              {:else}
                {#each quickScoutModel.by_team as row}
                  <tr>
                    <td data-label="Team">{String(row.team_key || '').replace(/^frc/i, '')}</td>
                    <td data-label="Avg % of Alliance Score">{row.avg_percent_of_alliance_score}%</td>
                    <td data-label="Avg Contribution (pts)">{row.avg_contribution_points}</td>
                    <td data-label="Matches Scored">{row.matches_scored}</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </details>
{/if}

<style>
  /* The same table and warning styles the Scouting Admin layout uses for its own tables. */
  .status-message {
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-xs);
    line-height: 1.4;
  }
  .status-warning {
    background: var(--status-pending-bg);
    border-color: var(--status-pending-border);
    color: var(--status-pending-text);
  }
  .table-wrap {
    overflow-x: auto;
  }

  @media (max-width: 640px) {
    .table-container {
      overflow-x: visible;
    }
    .table thead {
      display: none;
    }
    .table,
    .table tbody,
    .table tr,
    .table td {
      display: block;
      width: 100%;
    }
    .table tr {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: var(--space-3);
      padding: var(--space-2) var(--space-3);
    }
    .table td {
      border: 0;
      border-bottom: 1px solid var(--border);
      padding: var(--space-2) 0;
    }
    .table td:last-child {
      border-bottom: 0;
    }
    .table td::before {
      content: attr(data-label);
      display: block;
      color: var(--text-muted);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    .table td.empty::before {
      content: none;
    }
  }
  .role-accordion {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .role-summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    cursor: pointer;
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
  }

  .role-summary::-webkit-details-marker {
    display: none;
  }

  .role-summary-title {
    font-size: var(--font-md);
  }

  .role-accordion[open] .role-summary {
    border-bottom: 1px solid var(--border);
  }

  .role-body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .smart-toolbar {
    display: flex;
    gap: var(--gap-3);
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .smart-title {
    font-size: var(--font-sm);
    font-weight: 700;
  }

  .smart-stats {
    display: grid;
    gap: var(--gap-2);
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .smart-stat {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
    font-size: var(--font-xs);
  }
</style>
